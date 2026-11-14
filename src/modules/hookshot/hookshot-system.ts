import { Vector3Utils } from "@minecraft/math";
import {
  BlockRaycastHit,
  EntityComponentTypes,
  EquipmentSlot,
  GameMode,
  ItemComponentTypes,
  Player,
  system,
  Vector3,
  world,
} from "@minecraft/server";
import {
  getDirectionVector,
  getMainhandItem,
  isInputButtonPressed,
  isSneakButtonPressed,
  PlayerStateManager,
} from "addon-utils";
import { HookRenderManager } from "../render";
import { PostFlightSystem } from "../post-flight";
import {
  calculateReelSpeedMultiplier,
  canUseGazeSteering,
} from "./math/steering-math";
import {
  AnchorPosition,
  HookshotDefinition,
  HookshotState,
  ReelConfig,
  ReelMode,
} from "./types";

const ACTIVE_HOOK_KEY = "hookshotActiveState";
const PENDING_RAYCAST_KEY = "hookshotPendingRaycast";
const LAST_USE_TICK_KEY = "hookshotLastUseTick";
const UI_ACTIVE_KEY = "hookshotUiActive";

interface PendingRaycastState {
  hookshotId: string;
  remainingTicks: number;
  dimensionId: string;
}

const DEFAULT_MAX_DISTANCE = 1200;
const DEFAULT_REEL_SPEED = 1.25;
const DEFAULT_MIN_ROPE_LENGTH = 1.5;
const DEFAULT_PROBING_MIN_HIT_DISTANCE = 1.5;

export class HookshotSystem {
  private static definitionsByItem = new Map<string, HookshotDefinition>();
  private static definitionsById = new Map<string, HookshotDefinition>();
  private static externalUnhookHandlers: Array<(player: Player) => void> = [];
  private static isInitialized = false;

  /**
   * フックショットの定義を登録します。
   */
  public static register(def: HookshotDefinition): void {
    this.definitionsByItem.set(def.itemTypeId, def);
    this.definitionsById.set(def.id, def);
  }

  /**
   * 指定されたアイテム typeId が登録済みのフックショットアイテムかどうかを判定します。
   */
  public static isHookshotItem(itemTypeId: string): boolean {
    return this.definitionsByItem.has(itemTypeId);
  }

  /**
   * 外部の特殊フックショットシステムが発射された時に、このシステムを解除するためのハンドラを登録します。
   * （疎結合な排他制御用）
   */
  public static registerExternalUnhookHandler(
    handler: (player: Player) => void,
  ): void {
    this.externalUnhookHandlers.push(handler);
  }

  /**
   * プレイヤーのアクティブなフックショット状態を取得します。
   */
  public static getActiveState(player: Player): HookshotState | null {
    return PlayerStateManager.get<HookshotState | null>(
      player.id,
      ACTIVE_HOOK_KEY,
      null,
    );
  }

  /**
   * フックを解除します。
   */
  public static unhook(player: Player): void {
    this.clearPendingRaycast(player);

    const state = this.getActiveState(player);
    if (!state) return;

    const def = this.definitionsById.get(state.hookshotId);
    const hasChargeRelease =
      def &&
      (def.releaseSoundId !== undefined || def.minReleaseStretch !== undefined);

    // チャージ中に解除された場合は、有効なチャージがあれば射出してから解除する
    if (
      hasChargeRelease &&
      state.isAnchored !== false &&
      state.isReelingIn &&
      player.dimension.id === state.anchor.dimensionId
    ) {
      const distance = Vector3Utils.distance(player.location, state.anchor);
      const stretch =
        Math.max(0, distance - state.currentLength) + (state.extraCharge ?? 0);
      const minStretch = def.minReleaseStretch ?? 0.5;
      if (stretch > minStretch) {
        state.isReelingIn = false;
        state.isChargeReleasing = true;
        state.releaseShotPending = true;
        const impulse = def.calculateImpulse(player, state);
        if (impulse.x !== 0 || impulse.y !== 0 || impulse.z !== 0) {
          player.applyImpulse(impulse);
        }
        this.playSoundSafe(player, def.releaseSoundId);
      }
    }

    PlayerStateManager.delete(player.id, ACTIVE_HOOK_KEY);
    this.clearDistanceUiIfActive(player);

    if (def?.onDetach) {
      def.onDetach(player, state);
    }
  }

  private static getPendingRaycast(player: Player): PendingRaycastState | null {
    return PlayerStateManager.get<PendingRaycastState | null>(
      player.id,
      PENDING_RAYCAST_KEY,
      null,
    );
  }

  private static clearPendingRaycast(player: Player): void {
    if (this.getPendingRaycast(player)) {
      PlayerStateManager.delete(player.id, PENDING_RAYCAST_KEY);
    }
  }

  /**
   * フックを発射・接続します。
   */
  public static shot(player: Player, def: HookshotDefinition): boolean {
    if (def.airProbing) {
      this.clearPendingRaycast(player);
      this.enterProbingState(player, def);
      this.playSoundSafe(player, def.shotSoundId);
      return true;
    }

    const maxDistance = def.maxDistance ?? DEFAULT_MAX_DISTANCE;

    const hit = player.getBlockFromViewDirection({
      maxDistance,
      includeLiquidBlocks: false,
      includePassableBlocks: false,
    });
    if (!hit) {
      const graceTicks = def.raycastGraceTicks ?? 0;
      if (graceTicks > 0) {
        this.notifyExternalUnhook(player);
        PlayerStateManager.set(player.id, PENDING_RAYCAST_KEY, {
          hookshotId: def.id,
          remainingTicks: graceTicks,
          dimensionId: player.dimension.id,
        } satisfies PendingRaycastState);
        this.playSoundSafe(player, def.shotSoundId);
        return true;
      }
      return false;
    }

    this.playSoundSafe(player, def.shotSoundId);
    this.attachFromHit(player, def, hit);
    return true;
  }

  private static attachFromHit(
    player: Player,
    def: HookshotDefinition,
    hit: BlockRaycastHit,
  ): void {
    this.clearPendingRaycast(player);
    this.notifyExternalUnhook(player);

    const state: HookshotState = {
      hookshotId: def.id,
      anchor: { dimensionId: player.dimension.id, x: 0, y: 0, z: 0 },
      isAnchored: true,
      currentLength: 0,
      jumpConsumed:
        isInputButtonPressed(player, "Jump") || player.isJumping,
      sneakConsumed: isSneakButtonPressed(player),
    };

    this.applyHitAnchor(
      player,
      state,
      def,
      hit,
      player.getHeadLocation(),
      player.getViewDirection(),
    );
  }

  /**
   * 構え（未着弾・平行移動）状態を開始します。
   */
  private static enterProbingState(
    player: Player,
    def: HookshotDefinition,
  ): void {
    const probing = def.airProbing;
    if (!probing) return;

    this.notifyExternalUnhook(player);

    const maxDistance =
      def.maxRopeLength ?? def.maxDistance ?? DEFAULT_MAX_DISTANCE;
    const head = player.getHeadLocation();
    const dir = Vector3Utils.normalize(player.getViewDirection());
    const initialLength = Math.min(probing.initialLength, maxDistance);
    const tip = Vector3Utils.add(head, Vector3Utils.scale(dir, initialLength));

    const probingState: HookshotState = {
      hookshotId: def.id,
      anchor: {
        dimensionId: player.dimension.id,
        x: tip.x,
        y: tip.y,
        z: tip.z,
      },
      isAnchored: false,
      probingDirection: dir,
      isAutoExtending: true,
      lastAutoExtendTick: system.currentTick,
      currentLength: initialLength,
      jumpConsumed:
        isInputButtonPressed(player, "Jump") || player.isJumping,
      sneakConsumed: isSneakButtonPressed(player),
    };

    PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, probingState);
  }

  /**
   * 外部の特殊フックショット解除ハンドラを実行します。
   */
  private static notifyExternalUnhook(player: Player): void {
    for (const handler of this.externalUnhookHandlers) {
      handler(player);
    }
  }

  /**
   * レイキャスト衝突結果をフックショット状態に反映してアンカー確定処理を行います。
   */
  private static applyHitAnchor(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
    hit: BlockRaycastHit,
    origin: Vector3,
    direction: Vector3,
  ): void {
    const normal = getDirectionVector(hit.face);
    const anchor = this.calculateAnchorPosition(
      player.dimension.id,
      origin,
      direction,
      hit,
      normal,
    );
    const distance = Vector3Utils.distance(player.location, anchor);

    // アンカーからプレイヤーへの初期方向ベクトル（刺さった瞬間の角度）
    // プレイヤーが着弾点に重なっている場合（真下撃ち等）は面法線を使用する
    const initialVector = Vector3Utils.subtract(player.location, anchor);
    const initialDistance = Vector3Utils.magnitude(initialVector);
    const initialDirection =
      initialDistance >= 0.25
        ? Vector3Utils.scale(initialVector, 1 / initialDistance)
        : normal;

    state.anchor = anchor;
    state.isAnchored = true;
    state.probingDirection = undefined;
    state.isAutoExtending = false;
    state.normal = normal;
    state.initialDirection = initialDirection;
    state.currentLength = distance;

    PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);

    if (def.onAttach) {
      def.onAttach(player, state);
      PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
    }

    this.playSoundSafe(player, def.hitSoundId ?? def.airProbing?.hitSoundId);
    this.consumeMainhandDurability(player, def.itemTypeId);
  }

  /**
   * メインハンドに所持しているフックショットアイテムの耐久値を1消費します。
   * クリエイティブモードでは消費しません。
   */
  private static consumeMainhandDurability(
    player: Player,
    expectedItemTypeId: string,
  ): void {
    if (!player.isValid) return;
    if (player.getGameMode() === GameMode.Creative) return;

    const equippable = player.getComponent(EntityComponentTypes.Equippable);
    if (!equippable) return;

    const item = equippable.getEquipment(EquipmentSlot.Mainhand);
    if (!item || item.typeId !== expectedItemTypeId) return;

    const durability = item.getComponent(ItemComponentTypes.Durability);
    if (!durability) return;

    const enchantable = item.getComponent(ItemComponentTypes.Enchantable);
    const unbreakingLevel =
      enchantable?.getEnchantment("unbreaking")?.level ?? 0;
    if (unbreakingLevel > 0 && Math.random() >= 1 / (unbreakingLevel + 1)) {
      return;
    }

    const nextDamage = durability.damage + 1;
    if (nextDamage >= durability.maxDurability) {
      equippable.setEquipment(EquipmentSlot.Mainhand, undefined);
      try {
        player.dimension.playSound("random.break", player.location, {
          volume: 1.0,
          pitch: 1.0,
        });
      } catch {}
    } else {
      durability.damage = nextDamage;
      equippable.setEquipment(EquipmentSlot.Mainhand, item);
    }
  }

  /**
   * 構え（未着弾）状態の平行移動・自動伸長とブロック接触判定を更新します。
   */
  private static updateProbingState(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
  ): void {
    const dir = state.probingDirection;
    if (!dir) return;

    const probing = def.airProbing;
    if (state.isAutoExtending && probing) {
      this.applyAutoExtend(player, state, def, probing.extend);
    }

    const head = player.getHeadLocation();
    const minHitDistance =
      probing?.minHitDistance ?? DEFAULT_PROBING_MIN_HIT_DISTANCE;

    const hit = player.dimension.getBlockFromRay(head, dir, {
      maxDistance: state.currentLength,
      includeLiquidBlocks: false,
      includePassableBlocks: false,
    });

    if (hit) {
      const normal = getDirectionVector(hit.face);
      const hitPos = this.calculateAnchorPosition(
        player.dimension.id,
        head,
        dir,
        hit,
        normal,
      );
      const hitDistance = Vector3Utils.distance(head, hitPos);

      if (hitDistance >= minHitDistance) {
        this.applyHitAnchor(player, state, def, hit, head, dir);
        return;
      }
    }

    const tip = Vector3Utils.add(
      head,
      Vector3Utils.scale(dir, state.currentLength),
    );
    state.anchor = {
      dimensionId: player.dimension.id,
      x: tip.x,
      y: tip.y,
      z: tip.z,
    };
    PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
  }

  private static applyAutoExtend(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
    extend: NonNullable<HookshotDefinition["airProbing"]>["extend"],
  ): void {
    const maxLength =
      def.maxRopeLength ?? def.maxDistance ?? DEFAULT_MAX_DISTANCE;

    if (extend.mode === "continuous") {
      if (extend.speed > 0) {
        const nextLength = Math.min(
          state.currentLength + extend.speed,
          maxLength,
        );
        if (nextLength !== state.currentLength) {
          state.currentLength = nextLength;
          if (extend.soundId) {
            const now = system.currentTick;
            const interval = extend.soundIntervalTicks ?? 2;
            const lastTick = state.lastAutoExtendTick ?? now;
            if (now - lastTick >= interval) {
              state.lastAutoExtendTick = now;
              this.playSoundSafe(player, extend.soundId);
            }
          }
        }
      }
    } else {
      const now = system.currentTick;
      const lastTick = state.lastAutoExtendTick ?? now;
      if (now - lastTick >= extend.intervalTicks) {
        state.lastAutoExtendTick = now;
        const nextLength = Math.min(
          state.currentLength + extend.stepLength,
          maxLength,
        );
        if (nextLength !== state.currentLength) {
          state.currentLength = nextLength;
          this.playSoundSafe(player, extend.soundId);
        }
      }
    }

    if (state.currentLength >= maxLength) {
      state.isAutoExtending = false;
    }
  }

  private static playSoundSafe(
    player: Player,
    soundId?: string,
    pitch?: number,
  ): void {
    if (!soundId) return;
    try {
      if (pitch !== undefined) {
        player.playSound(soundId, { pitch });
      } else {
        player.playSound(soundId);
      }
    } catch {}
  }

  /**
   * チャージ中の伸び量（stretch）に応じたマイルストーン効果音を再生します。
   */
  private static updateChargeMilestoneSound(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
    distance: number,
  ): void {
    const config = def.chargeMilestoneSound;
    if (!config) return;

    if (!state.isReelingIn) {
      if (
        state.prevChargeStretch !== undefined ||
        state.lastChargeSoundThreshold !== undefined ||
        state.canRetriggerLastThreshold !== undefined
      ) {
        state.prevChargeStretch = undefined;
        state.lastChargeSoundThreshold = undefined;
        state.canRetriggerLastThreshold = undefined;
        PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
      }
      return;
    }

    const stretch =
      Math.max(0, distance - state.currentLength) + (state.extraCharge ?? 0);
    if (stretch <= 0) {
      if (state.prevChargeStretch !== 0) {
        state.prevChargeStretch = 0;
        PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
      }
      return;
    }

    const prev = state.prevChargeStretch ?? stretch;
    let dirty = false;

    if (
      state.lastChargeSoundThreshold !== undefined &&
      !state.canRetriggerLastThreshold &&
      Math.abs(stretch - state.lastChargeSoundThreshold) >= config.hysteresis
    ) {
      state.canRetriggerLastThreshold = true;
      dirty = true;
    }

    const maxSteps = Math.floor(config.maxStretch / config.step);
    for (let i = 1; i <= maxSteps; i++) {
      const threshold = config.step * i;
      const crossedUp = prev < threshold && stretch >= threshold;
      const crossedDown = prev >= threshold && stretch < threshold;
      if (!crossedUp && !crossedDown) continue;

      if (
        state.lastChargeSoundThreshold === threshold &&
        !state.canRetriggerLastThreshold
      ) {
        continue;
      }

      const pitch =
        config.pitches[Math.min(i - 1, config.pitches.length - 1)] ?? 1.0;
      this.playSoundSafe(player, config.soundId, pitch);
      state.lastChargeSoundThreshold = threshold;
      state.canRetriggerLastThreshold = false;
      dirty = true;
    }

    if (state.prevChargeStretch !== stretch) {
      state.prevChargeStretch = stretch;
      dirty = true;
    }

    if (dirty) {
      PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
    }
  }

  /**
   * フックのトグル処理（排他制御対応）
   */
  public static toggleHook(player: Player, def: HookshotDefinition): void {
    const pending = this.getPendingRaycast(player);
    if (pending) {
      this.clearPendingRaycast(player);
      this.clearDistanceUiIfActive(player);
      if (pending.hookshotId === def.id) {
        return;
      }
    }

    const currentState = this.getActiveState(player);

    if (currentState) {
      // 既に接続中のフックがある場合
      if (currentState.hookshotId === def.id) {
        // 同じフックショットなら解除（トグル動作）
        this.unhook(player);
        return;
      } else {
        // 異なるフックショットなら、前のフックを解除して新しいフックを発射（排他切り替え）
        this.unhook(player);
        this.shot(player, def);
        return;
      }
    }

    // 未接続なら発射
    this.shot(player, def);
  }

  /**
   * 右クリックイベントの共通ハンドラ
   */
  private static handleUse(player: Player, itemTypeId?: string): void {
    if (!itemTypeId) return;

    const def = this.definitionsByItem.get(itemTypeId);
    if (!def) return;

    // 同一Tickでの重複発火防止 (itemUse と itemStartUseOn の重複抑止)
    const lastTick = PlayerStateManager.get<number | null>(
      player.id,
      LAST_USE_TICK_KEY,
      null,
    );
    if (lastTick === system.currentTick) return;
    PlayerStateManager.set(player.id, LAST_USE_TICK_KEY, system.currentTick);

    this.toggleHook(player, def);
  }

  /**
   * キー入力に応じたロープの伸縮処理を実行します。
   * - ジャンプ（空中時）: 通常方向（デフォルト "shorten"）
   * - スニーク/Shift（空中・接地問わず）: 逆方向（デフォルト "extend"）
   * - 両方同時押し・入力なし: 何もしない
   */
  private static handleReelInput(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
  ): ReelMode | null {
    if (!player.isValid) return null;

    let jumpPressed = false;
    let sneakPressed = false;
    let onGround = false;
    try {
      jumpPressed =
        isInputButtonPressed(player, "Jump") || player.isJumping;
      sneakPressed = isSneakButtonPressed(player);
      onGround = player.isOnGround;
    } catch {
      return null;
    }

    let stateDirty = false;

    if (!jumpPressed && state.jumpConsumed) {
      state.jumpConsumed = false;
      stateDirty = true;
    }
    if (!sneakPressed && state.sneakConsumed) {
      state.sneakConsumed = false;
      stateDirty = true;
    }

    const effectiveJumpPressed = jumpPressed && !state.isChargeReleasing;
    const hasChargeRelease =
      def.releaseSoundId !== undefined || def.minReleaseStretch !== undefined;

    // 両方同時押しなら中立（何もしない。チャージ＆リリース型では発射せずチャージを維持）
    if (effectiveJumpPressed && sneakPressed) {
      if (!hasChargeRelease && state.isReelingIn) {
        state.isReelingIn = false;
        stateDirty = true;
      }
      if (this.resetStepReelState(state)) {
        stateDirty = true;
      }
      if (stateDirty) {
        PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
      }
      return null;
    }

    const baseMode = def.reelMode ?? "shorten";
    const reverseMode = baseMode === "extend" ? "shorten" : "extend";

    // シフト（スニーク）は地上・空中のどちらでも逆方向（長くする）に動作（チャージ＆リリース型では発射せず維持）
    if (sneakPressed) {
      if (!hasChargeRelease && state.isReelingIn) {
        state.isReelingIn = false;
        stateDirty = true;
      }
      const isInitial = !state.sneakConsumed;
      if (isInitial) {
        state.sneakConsumed = true;
        stateDirty = true;
      }
      this.handleDirectionalReel(
        player,
        state,
        def,
        reverseMode,
        isInitial,
        stateDirty,
      );
      return reverseMode;
    }

    // ジャンプは空中時のみ通常方向（短くする）に動作（放物線飛行中は無効）
    if (effectiveJumpPressed && !onGround) {
      if (baseMode === "shorten" && !state.isReelingIn) {
        state.isReelingIn = true;
        stateDirty = true;
      }
      const isInitial = !state.jumpConsumed;
      if (isInitial) {
        state.jumpConsumed = true;
        stateDirty = true;
      }
      this.handleDirectionalReel(
        player,
        state,
        def,
        baseMode,
        isInitial,
        stateDirty,
      );
      return baseMode;
    }

    // すでに巻き取り中（チャージ中）に着地した場合は、ジャンプキーを離すまでチャージ状態を維持する
    if (effectiveJumpPressed && onGround && state.isReelingIn) {
      if (stateDirty) {
        PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
      }
      return null;
    }

    if (state.isReelingIn) {
      state.isReelingIn = false;
      stateDirty = true;
    }
    if (this.resetStepReelState(state)) {
      stateDirty = true;
    }

    if (stateDirty) {
      PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
    }
    return null;
  }

  private static shouldDetachOnMaxExtend(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
    activeReelMode: ReelMode | null,
  ): boolean {
    if (
      !def.detachOnMaxExtend ||
      state.isAnchored === false ||
      activeReelMode !== "extend"
    ) {
      return false;
    }
    const maxLength =
      def.maxRopeLength ?? def.maxDistance ?? DEFAULT_MAX_DISTANCE;
    if (state.currentLength < maxLength) {
      return false;
    }
    const distance = Vector3Utils.distance(player.location, state.anchor);
    return distance >= state.currentLength;
  }

  private static shouldDetachOnOutwardSpeed(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
  ): boolean {
    if (
      def.detachOnOutwardSpeed === undefined ||
      state.isAnchored === false
    ) {
      return false;
    }
    const toPlayer = Vector3Utils.subtract(player.location, state.anchor);
    const distance = Vector3Utils.magnitude(toPlayer);
    if (distance < state.currentLength || distance < 0.0001) {
      return false;
    }
    const outwardDir = Vector3Utils.scale(toPlayer, 1 / distance);
    const outwardSpeed = Vector3Utils.dot(player.getVelocity(), outwardDir);
    return outwardSpeed >= def.detachOnOutwardSpeed;
  }

  private static resetStepReelState(state: HookshotState): boolean {
    if (
      state.currentStepIntervalTicks === undefined &&
      state.lastStepMode === undefined
    ) {
      return false;
    }
    state.currentStepIntervalTicks = undefined;
    state.lastStepMode = undefined;
    return true;
  }

  private static handleDirectionalReel(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
    mode: ReelMode,
    isInitial: boolean,
    forceSave: boolean,
  ): void {
    if (state.isAutoExtending) {
      if (mode === "extend") {
        // 自動伸長中は伸びるボタンによる二重加速を行わない
        if (forceSave) {
          PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
        }
        return;
      }
      // 縮めるボタンで自動伸長を停止し、以降は通常伸縮へ移行
      state.isAutoExtending = false;
      forceSave = true;
    }

    this.reel(player, state, def, mode, isInitial, forceSave);
  }

  /**
   * ロープの長さ変更処理（短縮または伸長）
   */
  private static reel(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
    mode: ReelMode,
    isInitial = false,
    forceSave = false,
  ): void {
    const reelConfig = def.reel ?? {
      mode: "continuous" as const,
      speed: DEFAULT_REEL_SPEED,
    };

    if (reelConfig.mode === "step") {
      this.reelByStep(player, state, def, reelConfig, mode, isInitial, forceSave);
      return;
    }

    const configuredInitial =
      typeof reelConfig.initialDelta === "object"
        ? mode === "extend"
          ? reelConfig.initialDelta.extend
          : reelConfig.initialDelta.shorten
        : reelConfig.initialDelta;

    const initialStep = isInitial ? (configuredInitial ?? 0) : 0;
    let baseSpeed = reelConfig.speed;
    if (
      mode === "shorten" &&
      state.isAnchored !== false &&
      reelConfig.slackSpeed !== undefined
    ) {
      const distance = Vector3Utils.distance(player.location, state.anchor);
      const slack = state.currentLength - distance;
      if (slack >= 0) {
        baseSpeed =
          slack >= reelConfig.slackSpeed
            ? reelConfig.slackSpeed
            : slack + (1 - slack / reelConfig.slackSpeed) * reelConfig.speed;
      }
    }
    let delta = baseSpeed + initialStep;

    // 視線ステアリング対応フックショットでエアロベスト装備中に短縮（巻き取り）する場合、
    // 回転方向の力を得た分だけ短縮速度を遅くする（横向きならロープが縮まず円周運動を維持）
    if (
      mode === "shorten" &&
      def.enableGazeSteering &&
      canUseGazeSteering(player)
    ) {
      const multiplier = calculateReelSpeedMultiplier(
        player,
        state.anchor,
        state.currentLength,
      );
      delta *= multiplier;
    }

    let continuousSoundId: string | undefined;
    if (reelConfig.soundId) {
      const interval = reelConfig.soundIntervalTicks ?? 4;
      const lastSoundTick = state.lastContinuousReelSoundTick;
      if (
        isInitial ||
        lastSoundTick === undefined ||
        system.currentTick - lastSoundTick >= interval
      ) {
        continuousSoundId = reelConfig.soundId;
      }
    }

    this.applyLengthDelta(
      player,
      state,
      def,
      mode,
      delta,
      forceSave,
      continuousSoundId,
    );
  }

  /**
   * ステップ式（一定ブロック数＋長押し加速）の伸縮処理
   */
  private static reelByStep(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
    stepConfig: Extract<ReelConfig, { mode: "step" }>,
    mode: ReelMode,
    isInitial: boolean,
    forceSave: boolean,
  ): void {
    const now = system.currentTick;
    const isNewDirectionOrTap = isInitial || state.lastStepMode !== mode;

    if (isNewDirectionOrTap) {
      state.lastStepReelTick = now;
      state.currentStepIntervalTicks = stepConfig.initialIntervalTicks;
      state.lastStepMode = mode;
      this.applyLengthDelta(
        player,
        state,
        def,
        mode,
        stepConfig.stepLength,
        true,
        stepConfig.soundId,
      );
      return;
    }

    const lastTick = state.lastStepReelTick ?? now;
    const currentInterval =
      state.currentStepIntervalTicks ?? stepConfig.initialIntervalTicks;

    if (now - lastTick < currentInterval) {
      if (forceSave) {
        PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
      }
      return;
    }

    state.lastStepReelTick = now;
    state.currentStepIntervalTicks = Math.max(
      stepConfig.minIntervalTicks,
      currentInterval - stepConfig.intervalDecayTicks,
    );
    this.applyLengthDelta(
      player,
      state,
      def,
      mode,
      stepConfig.stepLength,
      true,
      stepConfig.soundId,
    );
  }

  private static applyLengthDelta(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
    mode: ReelMode,
    delta: number,
    forceSave: boolean,
    soundId?: string,
  ): void {
    const prevLength = state.currentLength;
    const prevExtra = state.extraCharge ?? 0;
    let nextLength = prevLength;
    let nextExtra = prevExtra;

    if (mode === "extend") {
      const maxLength =
        def.maxRopeLength ?? def.maxDistance ?? DEFAULT_MAX_DISTANCE;
      if (prevExtra > 0) {
        const consumedExtra = Math.min(prevExtra, delta);
        nextExtra = prevExtra - consumedExtra;
        const remaining = delta - consumedExtra;
        if (remaining > 0) {
          nextLength = Math.min(prevLength + remaining, maxLength);
        }
      } else {
        nextLength = Math.min(prevLength + delta, maxLength);
      }
    } else {
      const minLength = def.minRopeLength ?? DEFAULT_MIN_ROPE_LENGTH;
      const maxExtra =
        state.isAnchored !== false ? (def.maxExtraCharge ?? 0) : 0;
      const shortenRoom = Math.max(0, prevLength - minLength);
      if (delta <= shortenRoom) {
        nextLength = Math.max(prevLength - delta, minLength);
      } else {
        nextLength = minLength;
        if (maxExtra > 0) {
          const remaining = delta - shortenRoom;
          nextExtra = Math.min(maxExtra, prevExtra + remaining);
        }
      }
    }

    const changed = prevLength !== nextLength || prevExtra !== nextExtra;
    if (changed) {
      state.currentLength = nextLength;
      state.extraCharge = nextExtra;
      if (soundId) {
        state.lastContinuousReelSoundTick = system.currentTick;
        this.playSoundSafe(player, soundId);
      }
    }
    if (changed || forceSave) {
      PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
    }
  }

  /**
   * システム初期化・イベント購読開始
   */
  public static init(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // 速度維持（ポストフライト）システムの初期化とフック接続中の抑制登録（構え中は抑制しない）
    PostFlightSystem.init();
    PostFlightSystem.registerSuppressor((player) => {
      const state = this.getActiveState(player);
      return state !== null && state.isAnchored !== false;
    });

    // 右クリック（空中での使用）
    world.afterEvents.itemUse.subscribe((event) => {
      this.handleUse(event.source, event.itemStack?.typeId);
    });

    // 右クリック（ブロックに対する使用）
    world.afterEvents.itemStartUseOn.subscribe((event) => {
      this.handleUse(event.source, event.itemStack?.typeId);
    });

    // 毎Tickの物理演算および巻き取りループ
    system.runInterval(() => {
      for (const player of world.getAllPlayers()) {
        const state = this.getActiveState(player);
        if (!state) {
          if (this.processPendingRaycast(player)) {
            continue;
          }
          // アンカー設置前: メインハンドにフックショットを持っている場合はプレビュー距離UIを更新
          this.updatePreviewDistanceUi(player);
          continue;
        }

        // ディメンションが変化した場合は自動解除
        if (player.dimension.id !== state.anchor.dimensionId) {
          this.unhook(player);
          continue;
        }

        const def = this.definitionsById.get(state.hookshotId);
        if (!def) continue;

        // キー入力によるロープ長の変更（ジャンプ＝短縮、シフト＝伸長、押下時の瞬間変化対応）
        const wasReelingIn = !!state.isReelingIn;
        const activeReelMode = this.handleReelInput(player, state, def);

        if (state.isAnchored !== false) {
          const distance = Vector3Utils.distance(player.location, state.anchor);
          let releaseStateDirty = false;

          if (state.isReelingIn) {
            if (
              state.isChargeReleasing ||
              state.releaseShotPending ||
              state.releaseStartTick !== undefined ||
              state.lastReleaseDistance !== undefined ||
              state.releaseStallTicks !== undefined
            ) {
              state.isChargeReleasing = false;
              state.releaseShotPending = false;
              state.releaseStartTick = undefined;
              state.lastReleaseDistance = undefined;
              state.releaseStallTicks = undefined;
              releaseStateDirty = true;
            }
          } else if (wasReelingIn && !state.isReelingIn) {
            const stretch =
              Math.max(0, distance - state.currentLength) +
              (state.extraCharge ?? 0);
            if (
              def.minReleaseStretch !== undefined &&
              stretch <= def.minReleaseStretch
            ) {
              const minLength = def.minRopeLength ?? DEFAULT_MIN_ROPE_LENGTH;
              const maxLength =
                def.maxRopeLength ?? def.maxDistance ?? DEFAULT_MAX_DISTANCE;
              state.currentLength = Math.max(
                minLength,
                Math.min(maxLength, distance),
              );
              state.extraCharge = 0;
              state.isChargeReleasing = false;
              state.releaseShotPending = false;
              state.releaseStartTick = undefined;
              state.lastReleaseDistance = undefined;
              state.releaseStallTicks = undefined;
              releaseStateDirty = true;
            } else if (stretch > 0.5) {
              state.isChargeReleasing = true;
              state.releaseShotPending = true;
              state.releaseStartTick = system.currentTick;
              state.lastReleaseDistance = distance;
              state.releaseStallTicks = 0;
              releaseStateDirty = true;
              if (def.releaseSoundId) {
                this.playSoundSafe(player, def.releaseSoundId);
              }
            }
          } else if (state.isChargeReleasing) {
            const elapsedTicks =
              system.currentTick - (state.releaseStartTick ?? system.currentTick);
            if (distance <= state.currentLength) {
              state.isChargeReleasing = false;
              state.releaseShotPending = false;
              state.releaseStartTick = undefined;
              state.lastReleaseDistance = undefined;
              state.releaseStallTicks = undefined;
              releaseStateDirty = true;
            } else if (elapsedTicks >= 4) {
              const approachSpeed =
                (state.lastReleaseDistance ?? distance) - distance;
              state.releaseStallTicks =
                approachSpeed <= 0.4 ? (state.releaseStallTicks ?? 0) + 1 : 0;
              const isStoppedOrPassed = state.releaseStallTicks >= 5;
              const isGrounded =
                player.isOnGround || player.isInWater || player.isClimbing;
              const isTimedOut = elapsedTicks >= 60;

              if (isStoppedOrPassed || isGrounded || isTimedOut) {
                const minLength = def.minRopeLength ?? DEFAULT_MIN_ROPE_LENGTH;
                const maxLength =
                  def.maxRopeLength ?? def.maxDistance ?? DEFAULT_MAX_DISTANCE;
                state.currentLength = Math.max(
                  minLength,
                  Math.min(maxLength, distance),
                );
                state.isChargeReleasing = false;
                state.releaseShotPending = false;
                state.releaseStartTick = undefined;
                state.lastReleaseDistance = undefined;
                state.releaseStallTicks = undefined;
                releaseStateDirty = true;
              } else {
                state.lastReleaseDistance = distance;
                releaseStateDirty = true;
              }
            } else {
              state.lastReleaseDistance = distance;
              releaseStateDirty = true;
            }
          }

          if (releaseStateDirty) {
            PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
          }

          this.updateChargeMilestoneSound(player, state, def, distance);
        }

        // 構え中（未着弾）の平行移動およびブロック接触判定
        if (state.isAnchored === false) {
          this.updateProbingState(player, state, def);
        }

        if (state.isAnchored !== false) {
          // 最高速度到達時（最大長到達＋自然長通過）または外向き高速突破時に自動解除
          if (
            this.shouldDetachOnMaxExtend(player, state, def, activeReelMode) ||
            this.shouldDetachOnOutwardSpeed(player, state, def)
          ) {
            this.playSoundSafe(player, def.detachSoundId);
            this.unhook(player);
            continue;
          }

          // 物理インパルス計算と適用
          const impulse = def.calculateImpulse(player, state);
          if (impulse.x !== 0 || impulse.y !== 0 || impulse.z !== 0) {
            player.applyImpulse(impulse);
          }

          if (state.releaseShotPending) {
            state.releaseShotPending = false;
            state.extraCharge = 0;
            PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
          }

          // ワイヤーの描画（定義側で getWireAxis が指定されている場合はその軸、無ければ state.normal）
          const wireAxis = def.getWireAxis
            ? def.getWireAxis(state)
            : state.normal;
          HookRenderManager.renderHookshot(
            player,
            state.anchor,
            state.hookshotId,
            def.wireStyle,
            state.currentLength,
            wireAxis,
          );
        } else {
          // 構え中はしなり・たるみ無しの直線として描画
          HookRenderManager.renderHookshot(
            player,
            state.anchor,
            state.hookshotId,
            def.wireStyle,
            undefined,
            undefined,
          );
        }

        // 接続中距離UIの更新（○○m / ○○m）
        this.updateDistanceUi(player, state, def);
      }
    });
  }

  /**
   * レイキャスト衝突結果からアンカー座標を計算します。
   */
  private static calculateAnchorPosition(
    dimensionId: string,
    origin: Vector3,
    direction: Vector3,
    hit: BlockRaycastHit,
    normal: Vector3 = getDirectionVector(hit.face),
  ): AnchorPosition {
    // 衝突面の中心座標
    const faceCenterX = hit.block.x + 0.5 + normal.x * 0.5;
    const faceCenterY = hit.block.y + 0.5 + normal.y * 0.5;
    const faceCenterZ = hit.block.z + 0.5 + normal.z * 0.5;

    // レイと平面の交点距離 t
    const dot =
      normal.x * direction.x + normal.y * direction.y + normal.z * direction.z;
    let anchorX = faceCenterX;
    let anchorY = faceCenterY;
    let anchorZ = faceCenterZ;

    if (Math.abs(dot) > 0.0001) {
      const t =
        (normal.x * (faceCenterX - origin.x) +
          normal.y * (faceCenterY - origin.y) +
          normal.z * (faceCenterZ - origin.z)) /
        dot;

      if (t > 0) {
        // 交点座標をブロック面の境界内 [0, 1] にクランプ
        anchorX = Math.max(
          hit.block.x,
          Math.min(hit.block.x + 1, origin.x + direction.x * t),
        );
        anchorY = Math.max(
          hit.block.y,
          Math.min(hit.block.y + 1, origin.y + direction.y * t),
        );
        anchorZ = Math.max(
          hit.block.z,
          Math.min(hit.block.z + 1, origin.z + direction.z * t),
        );
      }
    }

    return {
      dimensionId,
      x: anchorX,
      y: anchorY,
      z: anchorZ,
    };
  }

  /**
   * 発射後の猶予Tick中の視線レイキャスト探索を処理します。
   * 探索中または今Tickで着弾した場合は true を返します。
   */
  private static processPendingRaycast(player: Player): boolean {
    const pending = this.getPendingRaycast(player);
    if (!pending) return false;

    const def = this.definitionsById.get(pending.hookshotId);
    if (!def || player.dimension.id !== pending.dimensionId) {
      this.clearPendingRaycast(player);
      this.clearDistanceUiIfActive(player);
      return false;
    }

    const maxDistance = def.maxDistance ?? DEFAULT_MAX_DISTANCE;
    const hit = player.getBlockFromViewDirection({
      maxDistance,
      includeLiquidBlocks: false,
      includePassableBlocks: false,
    });
    if (hit) {
      this.attachFromHit(player, def, hit);
      return true;
    }

    const remainingTicks = pending.remainingTicks - 1;
    if (remainingTicks <= 0) {
      this.clearPendingRaycast(player);
      this.clearDistanceUiIfActive(player);
      this.playSoundSafe(player, def.missSoundId);
      return false;
    }

    PlayerStateManager.set(player.id, PENDING_RAYCAST_KEY, {
      ...pending,
      remainingTicks,
    });

    try {
      player.onScreenDisplay.setActionBar(
        `[探索中] ${maxDistance.toFixed(1)}m (${remainingTicks}t)`,
      );
      PlayerStateManager.set(player.id, UI_ACTIVE_KEY, true);
    } catch {}

    return true;
  }

  /**
   * アンカー設置前の距離UI（アクションバー）の更新
   * 視線の先のブロックまでの距離 / 持っているフックショットの最大射程
   */
  private static updatePreviewDistanceUi(player: Player): void {
    const mainhandItem = getMainhandItem(player);
    if (!mainhandItem) {
      this.clearDistanceUiIfActive(player);
      return;
    }

    const def = this.definitionsByItem.get(mainhandItem.typeId);
    if (!def) {
      this.clearDistanceUiIfActive(player);
      return;
    }

    const maxDistance = def.maxDistance ?? DEFAULT_MAX_DISTANCE;
    const raycastDistance = Math.max(maxDistance, 250);

    const hit = player.getBlockFromViewDirection({
      maxDistance: raycastDistance,
      includeLiquidBlocks: false,
      includePassableBlocks: false,
    });

    if (!hit) {
      this.clearDistanceUiIfActive(player);
      return;
    }

    const anchor = this.calculateAnchorPosition(
      player.dimension.id,
      player.getHeadLocation(),
      player.getViewDirection(),
      hit,
    );
    const distance = Vector3Utils.distance(player.location, anchor);

    try {
      player.onScreenDisplay.setActionBar(
        `${distance.toFixed(1)}m / ${maxDistance.toFixed(1)}m`,
      );
      PlayerStateManager.set(player.id, UI_ACTIVE_KEY, true);
    } catch {
      // プレイヤー切断時などのエラー抑止
    }
  }

  /**
   * フックショットUIが表示中の場合のみアクションバーをクリア
   */
  private static clearDistanceUiIfActive(player: Player): void {
    const isActive = PlayerStateManager.get<boolean>(
      player.id,
      UI_ACTIVE_KEY,
      false,
    );
    if (!isActive) return;

    PlayerStateManager.delete(player.id, UI_ACTIVE_KEY);
    try {
      player.onScreenDisplay.setActionBar("");
    } catch {}
  }

  /**
   * 接続中距離UI（アクションバー）の更新
   */
  private static updateDistanceUi(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
  ): void {
    try {
      if (state.isAnchored === false) {
        const maxLength =
          def.maxRopeLength ?? def.maxDistance ?? DEFAULT_MAX_DISTANCE;
        player.onScreenDisplay.setActionBar(
          `[構え] ${state.currentLength.toFixed(1)}m / ${maxLength.toFixed(1)}m`,
        );
      } else {
        const distance = Vector3Utils.distance(player.location, state.anchor);
        const text = def.formatDistanceUi
          ? def.formatDistanceUi(player, state, distance)
          : `${distance.toFixed(1)}m / ${state.currentLength.toFixed(1)}m`;
        player.onScreenDisplay.setActionBar(text);
      }
      PlayerStateManager.set(player.id, UI_ACTIVE_KEY, true);
    } catch {
      // プレイヤー切断時などのエラー抑止
    }
  }
}
