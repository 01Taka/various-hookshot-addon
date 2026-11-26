import { Vector3Utils } from "@minecraft/math";
import {
  BlockRaycastHit,
  EntityComponentTypes,
  EquipmentSlot,
  GameMode,
  ItemComponentTypes,
  ItemStack,
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
import { HookRenderManager, LineRenderer, WireStyle } from "../render";
import { PostFlightSystem } from "../post-flight";
import {
  DEFAULT_CONTINUOUS_SOUND_INTERVAL_TICKS,
  DEFAULT_PROBING_MIN_HIT_DISTANCE,
  DEFAULT_TIMED_SOUND_INTERVAL_TICKS,
  PROJECTION_FALLBACK_DISTANCE,
  RETRACT_END_MIN_DISTANCE,
  RETRACT_START_MIN_DISTANCE,
} from "./constants";
import {
  AirProbingConfig,
  AirProbingState,
  AnchorPosition,
  ContinuousReelState,
  HookshotContext,
  HookshotDefinition,
  HookshotId,
  HookshotState,
  ReelConfig,
  ReelMode,
  RetractConfig,
  RetractState,
  StepReelState,
  UnhookOptions,
} from "./types";

const ACTIVE_HOOK_KEY = "hookshotActiveState";
const PENDING_RAYCAST_KEY = "hookshotPendingRaycast";
const LAST_USE_TICK_KEY = "hookshotLastUseTick";

export interface PendingRaycastState {
  hookshotId: HookshotId;
  slotIndex?: number;
  remainingTicks: number;
  dimensionId: string;
}

export class HookshotSystem {
  private static definitionsByItem = new Map<string, HookshotDefinition>();
  private static definitionsById = new Map<HookshotId, HookshotDefinition>();
  private static isInitialized = false;

  private static readonly context: HookshotContext = {
    playSound: (player, soundId, pitch) =>
      this.playSoundSafe(player, soundId, pitch),
    unhook: (player, options) => this.unhook(player, options),
    consumeDurability: (player, expectedItemTypeId, slotIndex) =>
      this.consumeHookshotDurability(player, expectedItemTypeId, slotIndex),
    setActiveState: (player, state) =>
      PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state),
    clearActiveState: (player) =>
      PlayerStateManager.delete(player.id, ACTIVE_HOOK_KEY),
  };

  public static isStateAnchored(state: HookshotState): boolean {
    return "isAnchored" in state
      ? (state as AirProbingState).isAnchored !== false
      : true;
  }

  public static isStateRetracting(state: HookshotState): boolean {
    return (
      "isRetracting" in state && !!(state as RetractState).isRetracting
    );
  }

  private static isStateAutoExtending(state: HookshotState): boolean {
    return (
      "isAutoExtending" in state &&
      !!(state as AirProbingState).isAutoExtending
    );
  }

  /**
   * フックショットの定義を登録します。
   */
  public static register(def: HookshotDefinition): void {
    this.definitionsByItem.set(def.itemTypeId, def);
    this.definitionsById.set(def.id, def);
  }

  /**
   * アイテム typeId から登録済みのフックショット定義を取得します。
   */
  public static getDefinitionByItem(
    itemTypeId: string,
  ): HookshotDefinition | undefined {
    return this.definitionsByItem.get(itemTypeId);
  }

  /**
   * フックショット ID から登録済みのフックショット定義を取得します。
   */
  public static getDefinitionById(
    hookshotId: HookshotId,
  ): HookshotDefinition | undefined {
    return this.definitionsById.get(hookshotId);
  }

  /**
   * 指定されたアイテム typeId が登録済みのフックショットアイテムかどうかを判定します。
   */
  public static isHookshotItem(itemTypeId: string): boolean {
    return this.definitionsByItem.has(itemTypeId);
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
  public static unhook(player: Player, options?: UnhookOptions): void {
    this.clearPendingRaycast(player);

    const state = this.getActiveState(player);
    if (!state || this.isStateRetracting(state)) return;

    const def = this.definitionsById.get(state.hookshotId);

    def?.onBeforeDetach?.(player, state, options, this.context);
    def?.onDetach?.(player, state, this.context);

    const isAnchored = this.isStateAnchored(state);
    if (def && isAnchored) {
      if (options?.overrideSoundId) {
        this.playSoundSafe(player, options.overrideSoundId);
      } else if (def.detachSoundId) {
        this.playSoundSafe(player, def.detachSoundId);
      }
      if (def.consumeDurabilityOnDetach !== false) {
        this.consumeHookshotDurability(player, def.itemTypeId, state.slotIndex);
      }
    }

    if (
      def?.retract &&
      player.dimension.id === state.anchor.dimensionId &&
      this.startRetract(player, state, def.retract, def.wireStyle)
    ) {
      return;
    }

    PlayerStateManager.delete(player.id, ACTIVE_HOOK_KEY);
  }

  public static getPendingRaycast(player: Player): PendingRaycastState | null {
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
    if (def.customShot) {
      this.clearPendingRaycast(player);
      return def.customShot(player, this.context);
    }

    if (def.airProbing) {
      this.clearPendingRaycast(player);
      this.enterProbingState(player, def);
      this.playSoundSafe(player, def.shotSoundId);
      return true;
    }

    const hit = player.getBlockFromViewDirection({
      maxDistance: def.maxDistance,
      includeLiquidBlocks: false,
      includePassableBlocks: false,
    });
    if (!hit) {
      const graceTicks = def.raycastGraceTicks ?? 0;
      if (graceTicks > 0) {
        PlayerStateManager.set(player.id, PENDING_RAYCAST_KEY, {
          hookshotId: def.id,
          slotIndex: player.selectedSlotIndex,
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

  private static createBaseState(
    player: Player,
    def: HookshotDefinition,
    anchor: AnchorPosition,
    currentLength: number,
  ): HookshotState {
    const state: HookshotState = {
      hookshotId: def.id,
      slotIndex: player.selectedSlotIndex,
      anchor,
      currentLength,
      jumpConsumed:
        isInputButtonPressed(player, "Jump") || player.isJumping,
      sneakConsumed: isSneakButtonPressed(player),
    };
    def.onCreateState?.(player, state);
    return state;
  }

  private static attachFromHit(
    player: Player,
    def: HookshotDefinition,
    hit: BlockRaycastHit,
  ): void {
    this.clearPendingRaycast(player);

    const state = this.createBaseState(
      player,
      def,
      { dimensionId: player.dimension.id, x: 0, y: 0, z: 0 },
      0,
    );
    if ("isAnchored" in state) {
      (state as AirProbingState).isAnchored = true;
    }

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

    const maxDistance = def.maxDistance;
    const head = player.getHeadLocation();
    const dir = Vector3Utils.normalize(player.getViewDirection());
    const initialLength = Math.min(probing.initialLength, maxDistance);
    const tip = Vector3Utils.add(head, Vector3Utils.scale(dir, initialLength));
    const anchor: AnchorPosition = {
      dimensionId: player.dimension.id,
      x: tip.x,
      y: tip.y,
      z: tip.z,
    };

    const probingState = this.createBaseState(
      player,
      def,
      anchor,
      initialLength,
    ) as HookshotState & AirProbingState;

    probingState.isAnchored = false;
    probingState.probingDirection = dir;
    probingState.isAutoExtending = true;
    probingState.lastAutoExtendTick = system.currentTick;

    PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, probingState);
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

    const initialVector = Vector3Utils.subtract(player.location, anchor);
    const initialDistance = Vector3Utils.magnitude(initialVector);
    const initialDirection =
      initialDistance >= PROJECTION_FALLBACK_DISTANCE
        ? Vector3Utils.scale(initialVector, 1 / initialDistance)
        : normal;

    state.anchor = anchor;
    state.normal = normal;
    state.currentLength = distance;

    if (def.airProbing) {
      const probingState = state as HookshotState & AirProbingState;
      probingState.isAnchored = true;
      probingState.probingDirection = undefined;
      probingState.isAutoExtending = false;
    }

    PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);

    if (def.onAttach) {
      def.onAttach(player, state, { initialDirection, distance }, this.context);
      PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
    }

    const hitSound = def.hitSoundId ?? def.airProbing?.hitSoundId;
    this.playSoundSafe(player, hitSound);
  }

  /**
   * アイテムを持ち替えたか（スロット変更、またはメインハンドのアイテムが別物に変化したか）を判定します。
   */
  private static hasSwitchedItem(
    player: Player,
    expectedItemTypeId: string,
    slotIndex?: number,
  ): boolean {
    if (slotIndex !== undefined && player.selectedSlotIndex !== slotIndex) {
      return true;
    }
    const mainhandItem = getMainhandItem(player);
    return mainhandItem?.typeId !== expectedItemTypeId;
  }

  /**
   * 解除時に使用していたフックショットアイテムの耐久値を1消費します。
   * クリエイティブモードでは消費しません。
   */
  private static consumeHookshotDurability(
    player: Player,
    expectedItemTypeId: string,
    slotIndex?: number,
  ): void {
    if (!player.isValid) return;
    if (player.getGameMode() === GameMode.Creative) return;

    const useMainhand =
      slotIndex === undefined || slotIndex === player.selectedSlotIndex;

    let item: ItemStack | undefined;
    let updateSlot: ((nextItem: ItemStack | undefined) => void) | undefined;

    if (useMainhand) {
      const equippable = player.getComponent(EntityComponentTypes.Equippable);
      if (!equippable) return;
      item = equippable.getEquipment(EquipmentSlot.Mainhand);
      updateSlot = (nextItem) =>
        equippable.setEquipment(EquipmentSlot.Mainhand, nextItem);
    } else {
      const inventory = player.getComponent(EntityComponentTypes.Inventory);
      const container = inventory?.container;
      if (!container || slotIndex < 0 || slotIndex >= container.size) return;
      item = container.getItem(slotIndex);
      updateSlot = (nextItem) => container.setItem(slotIndex, nextItem);
    }

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
      updateSlot(undefined);
      try {
        player.dimension.playSound("random.break", player.location, {
          volume: 1.0,
          pitch: 1.0,
        });
      } catch {}
    } else {
      durability.damage = nextDamage;
      updateSlot(item);
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
    const probing = def.airProbing;
    if (!probing) return;

    const probingState = state as HookshotState & AirProbingState;
    const dir = probingState.probingDirection;
    if (!dir) return;

    if (probingState.isAutoExtending) {
      this.applyAutoExtend(player, probingState, def, probing.extend);
    }

    const head = player.getHeadLocation();
    const minHitDistance =
      probing.minHitDistance ?? DEFAULT_PROBING_MIN_HIT_DISTANCE;

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

  /**
   * continuous / step 設定に基づいて長さを1Tick分進め（または縮め）、必要な効果音を再生します。
   */
  private static advanceTimedLength(
    player: Player,
    currentLength: number,
    targetLimit: number,
    direction: 1 | -1,
    lastTick: number | undefined,
    config: RetractConfig,
  ): { nextLength: number; nextLastTick: number } {
    const now = system.currentTick;
    let nextLength = currentLength;
    let nextLastTick = lastTick ?? now;

    const clampLength = (val: number) =>
      direction > 0 ? Math.min(val, targetLimit) : Math.max(val, targetLimit);

    if (config.mode === "continuous") {
      if (config.speed > 0) {
        nextLength = clampLength(currentLength + direction * config.speed);
        if (
          nextLength !== currentLength &&
          config.soundId &&
          (direction > 0 || nextLength > 0)
        ) {
          const interval =
            config.soundIntervalTicks ?? DEFAULT_TIMED_SOUND_INTERVAL_TICKS;
          if (now - nextLastTick >= interval) {
            nextLastTick = now;
            this.playSoundSafe(player, config.soundId);
          }
        }
      } else if (direction < 0) {
        nextLength = targetLimit;
      }
    } else if (now - nextLastTick >= config.intervalTicks) {
      nextLastTick = now;
      nextLength = clampLength(currentLength + direction * config.stepLength);
      if (
        nextLength !== currentLength &&
        config.soundId &&
        (direction > 0 || nextLength > 0)
      ) {
        this.playSoundSafe(player, config.soundId);
      }
    }

    return { nextLength, nextLastTick };
  }

  private static applyAutoExtend(
    player: Player,
    state: HookshotState & AirProbingState,
    def: HookshotDefinition,
    extend: AirProbingConfig["extend"],
  ): void {
    const maxLength = def.maxDistance;

    const { nextLength, nextLastTick } = this.advanceTimedLength(
      player,
      state.currentLength,
      maxLength,
      1,
      state.lastAutoExtendTick,
      extend,
    );
    state.currentLength = nextLength;
    state.lastAutoExtendTick = nextLastTick;

    if (state.currentLength >= maxLength) {
      state.isAutoExtending = false;
    }
  }

  /**
   * 解除時の格納（縮める）アニメーション状態へ移行します。
   */
  private static startRetract(
    player: Player,
    state: HookshotState,
    retract: RetractConfig,
    wireStyle?: WireStyle,
  ): boolean {
    const probingState = state as HookshotState & AirProbingState;
    let retractDirection: Vector3;
    let retractLength: number;
    let initialRenderDist: number;

    if (probingState.isAnchored !== false) {
      const toAnchor = Vector3Utils.subtract(state.anchor, player.location);
      const dist = Vector3Utils.magnitude(toAnchor);
      if (dist <= RETRACT_START_MIN_DISTANCE) return false;
      retractDirection = Vector3Utils.scale(toAnchor, 1 / dist);
      retractLength = dist;
      initialRenderDist = Vector3Utils.magnitude(
        Vector3Utils.subtract(state.anchor, LineRenderer.getHandPosition(player)),
      );
    } else {
      retractLength = state.currentLength;
      if (retractLength <= RETRACT_START_MIN_DISTANCE) return false;
      retractDirection = probingState.probingDirection ?? player.getViewDirection();
      initialRenderDist = retractLength;
    }

    const retractThicknessScore =
      wireStyle && (wireStyle.ratioSpacing || wireStyle.ringRadiusScaling)
        ? LineRenderer.calculateThicknessScore(
            wireStyle,
            initialRenderDist,
            state.currentLength,
          )
        : undefined;

    const retractState: HookshotState & AirProbingState & RetractState = {
      ...state,
      isAnchored: false,
      isAutoExtending: false,
      isReelingIn: false,
      isRetracting: true,
      retractDirection,
      retractLength,
      retractThicknessScore,
      lastRetractTick:
        retract.mode === "step"
          ? system.currentTick - retract.intervalTicks
          : system.currentTick,
    };

    PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, retractState);
    return true;
  }

  /**
   * 格納中（縮めるアニメーション・クールダウン）の毎Tick更新と描画を行います。
   */
  private static updateRetractingState(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
  ): void {
    const retract = def.retract;
    if (!retract) {
      PlayerStateManager.delete(player.id, ACTIVE_HOOK_KEY);
      return;
    }

    const retractState = state as HookshotState & RetractState;
    const dir = retractState.retractDirection;
    if (!dir) {
      PlayerStateManager.delete(player.id, ACTIVE_HOOK_KEY);
      return;
    }

    const { nextLength: currentLength, nextLastTick } =
      this.advanceTimedLength(
        player,
        retractState.retractLength ?? 0,
        0,
        -1,
        retractState.lastRetractTick,
        retract,
      );
    retractState.lastRetractTick = nextLastTick;

    if (currentLength <= RETRACT_END_MIN_DISTANCE) {
      PlayerStateManager.delete(player.id, ACTIVE_HOOK_KEY);
      return;
    }

    retractState.retractLength = currentLength;
    PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, retractState);

    const head = player.getHeadLocation();
    const tip = Vector3Utils.add(head, Vector3Utils.scale(dir, currentLength));
    HookRenderManager.renderHookshot(
      player,
      tip,
      state.hookshotId,
      def.wireStyle,
      undefined,
      undefined,
      undefined,
      retractState.retractThicknessScore,
    );
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
   * フックのトグル処理（排他制御対応）
   */
  public static toggleHook(player: Player, def: HookshotDefinition): void {
    const pending = this.getPendingRaycast(player);
    if (pending) {
      this.clearPendingRaycast(player);
      if (pending.hookshotId === def.id) {
        return;
      }
    }

    const currentState = this.getActiveState(player);

    if (currentState) {
      if (this.isStateRetracting(currentState)) {
        return;
      }
      if (currentState.hookshotId === def.id) {
        if (def.onToggleWhileActive?.(player, currentState, this.context)) {
          return;
        }
        this.unhook(player);
        return;
      } else {
        this.unhook(player);
        const nextState = this.getActiveState(player);
        if (nextState && this.isStateRetracting(nextState)) {
          return;
        }
        this.shot(player, def);
        return;
      }
    }

    this.shot(player, def);
  }

  /**
   * 右クリックイベントの共通ハンドラ
   */
  private static handleUse(player: Player, itemTypeId?: string): void {
    if (!itemTypeId) return;

    const def = this.definitionsByItem.get(itemTypeId);
    if (!def) return;

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
   */
  private static handleReelInput(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
  ): ReelMode | null {
    if (!player.isValid || !def.reel) return null;

    let jumpPressed = false;
    let sneakPressed = false;
    try {
      jumpPressed =
        isInputButtonPressed(player, "Jump") || player.isJumping;
      sneakPressed = isSneakButtonPressed(player);
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

    if (
      this.isStateAutoExtending(state) ||
      (def.canHandleReelInput && !def.canHandleReelInput(player, state))
    ) {
      if (stateDirty) {
        PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
      }
      return null;
    }

    const hasChargeRelease = !!def.hasChargeRelease;
    const isChargeReleasing =
      hasChargeRelease &&
      "isChargeReleasing" in state &&
      !!(state as { isChargeReleasing?: boolean }).isChargeReleasing;
    const effectiveJumpPressed = jumpPressed && !isChargeReleasing;

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

    if (effectiveJumpPressed) {
      const blockedByHook =
        def.isReelBlocked?.(player, state, baseMode, this.context) ?? false;
      if (
        blockedByHook ||
        this.isReelBlockedByLengthDiff(player, state, def, baseMode)
      ) {
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

  private static isReelBlockedByLengthDiff(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
    mode: ReelMode,
  ): boolean {
    const limit = def.reelLengthDiffLimit;
    if (!limit || !this.isStateAnchored(state)) {
      return false;
    }
    const distance = Vector3Utils.distance(player.location, state.anchor);
    if (mode === "shorten" && limit.outward !== undefined) {
      return distance - state.currentLength >= limit.outward;
    }
    if (mode === "extend" && limit.inward !== undefined) {
      return state.currentLength - distance >= limit.inward;
    }
    return false;
  }

  private static resetStepReelState(state: HookshotState): boolean {
    const stepState = state as HookshotState & StepReelState;
    if (
      stepState.currentStepIntervalTicks === undefined &&
      stepState.lastStepMode === undefined
    ) {
      return false;
    }
    stepState.currentStepIntervalTicks = undefined;
    stepState.lastStepMode = undefined;
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
    if (this.isStateAutoExtending(state)) {
      if (forceSave) {
        PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
      }
      return;
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
    const reelConfig = def.reel;
    if (!reelConfig) return;

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
    const configuredSpeed =
      typeof reelConfig.speed === "object"
        ? mode === "extend"
          ? reelConfig.speed.extend
          : reelConfig.speed.shorten
        : reelConfig.speed;

    let baseSpeed = configuredSpeed;
    if (
      mode === "shorten" &&
      this.isStateAnchored(state) &&
      reelConfig.slackSpeed !== undefined
    ) {
      const distance = Vector3Utils.distance(player.location, state.anchor);
      const slack = state.currentLength - distance;
      if (slack >= 0) {
        baseSpeed =
          slack >= reelConfig.slackSpeed
            ? reelConfig.slackSpeed
            : slack + (1 - slack / reelConfig.slackSpeed) * configuredSpeed;
      }
    }

    if (def.modifyReelSpeed) {
      baseSpeed = def.modifyReelSpeed(player, state, mode, baseSpeed, isInitial);
    }

    const delta = baseSpeed + initialStep;

    let continuousSoundId: string | undefined;
    if (reelConfig.soundId) {
      const interval =
        reelConfig.soundIntervalTicks ?? DEFAULT_CONTINUOUS_SOUND_INTERVAL_TICKS;
      const lastSoundTick = (state as ContinuousReelState)
        .lastContinuousReelSoundTick;
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
    const stepState = state as HookshotState & StepReelState;
    const now = system.currentTick;
    const isNewDirectionOrTap = isInitial || stepState.lastStepMode !== mode;

    if (isNewDirectionOrTap) {
      stepState.lastStepReelTick = now;
      stepState.currentStepIntervalTicks = stepConfig.initialIntervalTicks;
      stepState.lastStepMode = mode;
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

    const lastTick = stepState.lastStepReelTick ?? now;
    const currentInterval =
      stepState.currentStepIntervalTicks ?? stepConfig.initialIntervalTicks;

    if (now - lastTick < currentInterval) {
      if (forceSave) {
        PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
      }
      return;
    }

    stepState.lastStepReelTick = now;
    stepState.currentStepIntervalTicks = Math.max(
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
    if (def.customApplyLengthDelta) {
      const changed = def.customApplyLengthDelta(
        player,
        state,
        mode,
        delta,
        forceSave,
        soundId,
        this.context,
      );
      if (changed && soundId) {
        (state as ContinuousReelState).lastContinuousReelSoundTick =
          system.currentTick;
        this.playSoundSafe(player, soundId);
      }
      if (changed || forceSave) {
        PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
      }
      return;
    }

    const prevLength = state.currentLength;
    const minLength = def.minRopeLength ?? 0;
    const maxLength = def.maxDistance;
    let nextLength =
      mode === "extend"
        ? Math.min(prevLength + delta, maxLength)
        : Math.max(prevLength - delta, minLength);

    const diffLimit = def.reelLengthDiffLimit;
    if (diffLimit && this.isStateAnchored(state)) {
      const distance = Vector3Utils.distance(player.location, state.anchor);
      if (mode === "extend" && diffLimit.inward !== undefined) {
        const maxAllowedByDiff = distance + diffLimit.inward;
        nextLength =
          prevLength >= maxAllowedByDiff
            ? prevLength
            : Math.min(nextLength, maxAllowedByDiff);
      } else if (mode === "shorten" && diffLimit.outward !== undefined) {
        const minAllowedByDiff = distance - diffLimit.outward;
        nextLength =
          prevLength <= minAllowedByDiff
            ? prevLength
            : Math.max(nextLength, minAllowedByDiff);
      }
    }

    const changed = prevLength !== nextLength;
    if (changed) {
      state.currentLength = nextLength;
      def.onLengthChanged?.(player, state, mode, prevLength, nextLength);
      if (soundId) {
        (state as ContinuousReelState).lastContinuousReelSoundTick =
          system.currentTick;
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

    PostFlightSystem.init();
    PostFlightSystem.registerSuppressor((player) => {
      const state = this.getActiveState(player);
      return state !== null && this.isStateAnchored(state);
    });

    world.afterEvents.itemUse.subscribe((event) => {
      this.handleUse(event.source, event.itemStack?.typeId);
    });

    world.afterEvents.itemStartUseOn.subscribe((event) => {
      this.handleUse(event.source, event.itemStack?.typeId);
    });

    system.runInterval(() => {
      for (const player of world.getAllPlayers()) {
        const state = this.getActiveState(player);
        if (!state) {
          this.processPendingRaycast(player);
          continue;
        }

        if (player.dimension.id !== state.anchor.dimensionId) {
          this.unhook(player);
          continue;
        }

        const def = this.definitionsById.get(state.hookshotId);
        if (!def) continue;

        if (this.isStateRetracting(state)) {
          this.updateRetractingState(player, state, def);
          continue;
        }

        if (this.hasSwitchedItem(player, def.itemTypeId, state.slotIndex)) {
          this.unhook(player);
          continue;
        }

        const wasReelingIn = !!state.isReelingIn;
        const activeReelMode = def.reel
          ? this.handleReelInput(player, state, def)
          : null;

        if (def.onTick) {
          const keep = def.onTick(
            player,
            state,
            { activeReelMode, wasReelingIn },
            this.context,
          );
          if (keep === false) {
            continue;
          }
        }

        if (!this.isStateAnchored(state)) {
          this.updateProbingState(player, state, def);
        }

        if (this.isStateAnchored(state)) {
          if (def.shouldDetach) {
            const distance = Vector3Utils.distance(player.location, state.anchor);
            const detachResult = def.shouldDetach(player, state, distance);
            if (detachResult.detach) {
              this.unhook(player, detachResult.options);
              continue;
            }
          }

          const impulse = def.calculateImpulse(player, state);
          if (impulse.x !== 0 || impulse.y !== 0 || impulse.z !== 0) {
            player.applyImpulse(impulse);
          }

          def.onImpulseApplied?.(player, state, impulse, this.context);

          if (def.render) {
            def.render(player, state);
          } else {
            HookRenderManager.renderHookshot(
              player,
              state.anchor,
              state.hookshotId,
              def.wireStyle,
              state.currentLength,
              def.getWireAxis?.(state) ?? state.normal,
              def.getRenderExtraCharge?.(state),
            );
          }
        } else {
          HookRenderManager.renderHookshot(
            player,
            state.anchor,
            state.hookshotId,
            def.wireStyle,
            undefined,
            undefined,
          );
        }
      }
    });
  }

  /**
   * レイキャスト衝突結果からアンカー座標を計算します。
   */
  public static calculateAnchorPosition(
    dimensionId: string,
    origin: Vector3,
    direction: Vector3,
    hit: BlockRaycastHit,
    normal: Vector3 = getDirectionVector(hit.face),
  ): AnchorPosition {
    const faceCenterX = hit.block.x + 0.5 + normal.x * 0.5;
    const faceCenterY = hit.block.y + 0.5 + normal.y * 0.5;
    const faceCenterZ = hit.block.z + 0.5 + normal.z * 0.5;

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
    if (
      !def ||
      player.dimension.id !== pending.dimensionId ||
      this.hasSwitchedItem(player, def.itemTypeId, pending.slotIndex)
    ) {
      this.clearPendingRaycast(player);
      return false;
    }

    const maxDistance = def.maxDistance;
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
      this.playSoundSafe(player, def.missSoundId);
      return false;
    }

    PlayerStateManager.set(player.id, PENDING_RAYCAST_KEY, {
      ...pending,
      remainingTicks,
    });

    return true;
  }
}
