import { Vector3Utils } from "@minecraft/math";
import {
  BlockRaycastHit,
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
import { calculateReelSpeedMultiplier } from "./math/steering-math";
import {
  AnchorPosition,
  HookshotDefinition,
  HookshotState,
  ReelConfig,
  ReelMode,
} from "./types";

const ACTIVE_HOOK_KEY = "hookshotActiveState";
const LAST_USE_TICK_KEY = "hookshotLastUseTick";
const UI_ACTIVE_KEY = "hookshotUiActive";

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
    const state = this.getActiveState(player);
    if (!state) return;

    PlayerStateManager.delete(player.id, ACTIVE_HOOK_KEY);
    this.clearDistanceUiIfActive(player);

    const def = this.definitionsById.get(state.hookshotId);
    if (def?.onDetach) {
      def.onDetach(player, state);
    }
  }

  /**
   * フックを発射・接続します。
   */
  public static shot(player: Player, def: HookshotDefinition): boolean {
    if (def.airProbing) {
      this.enterProbingState(player, def);
      return true;
    }

    const maxDistance = def.maxDistance ?? DEFAULT_MAX_DISTANCE;

    const hit = player.getBlockFromViewDirection({
      maxDistance,
      includeLiquidBlocks: false,
      includePassableBlocks: false,
    });
    if (!hit) {
      return false;
    }

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

    return true;
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
    const initialVector = Vector3Utils.subtract(player.location, anchor);
    const initialDistance = Vector3Utils.magnitude(initialVector);
    const initialDirection =
      initialDistance > 0.0001
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
        this.playSoundSafe(player, probing?.hitSoundId);
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
        state.currentLength = Math.min(
          state.currentLength + extend.speed,
          maxLength,
        );
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

  private static playSoundSafe(player: Player, soundId?: string): void {
    if (!soundId) return;
    try {
      player.playSound(soundId);
    } catch {}
  }

  /**
   * フックのトグル処理（排他制御対応）
   */
  public static toggleHook(player: Player, def: HookshotDefinition): void {
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
  ): void {
    if (!player.isValid) return;

    let jumpPressed = false;
    let sneakPressed = false;
    let onGround = false;
    try {
      jumpPressed =
        isInputButtonPressed(player, "Jump") || player.isJumping;
      sneakPressed = isSneakButtonPressed(player);
      onGround = player.isOnGround;
    } catch {
      return;
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

    // 両方同時押しなら中立（何もしない）
    if (jumpPressed && sneakPressed) {
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
      return;
    }

    const baseMode = def.reelMode ?? "shorten";
    const reverseMode = baseMode === "extend" ? "shorten" : "extend";

    // シフト（スニーク）は地上・空中のどちらでも逆方向（長くする）に動作
    if (sneakPressed) {
      if (state.isReelingIn) {
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
      return;
    }

    // ジャンプは空中時のみ通常方向（短くする）に動作
    if (jumpPressed && !onGround) {
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
      return;
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
    let delta = reelConfig.speed + initialStep;

    // 視線ステアリング対応フックショットで短縮（巻き取り）中の場合、
    // 回転方向の力を得た分だけ短縮速度を遅くする（横向きならロープが縮まず円周運動を維持）
    if (mode === "shorten" && def.enableGazeSteering) {
      const multiplier = calculateReelSpeedMultiplier(
        player,
        state.anchor,
        state.currentLength,
      );
      delta *= multiplier;
    }

    this.applyLengthDelta(player, state, def, mode, delta, forceSave);
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
    let nextLength = state.currentLength;
    if (mode === "extend") {
      const maxLength =
        def.maxRopeLength ?? def.maxDistance ?? DEFAULT_MAX_DISTANCE;
      nextLength = Math.min(state.currentLength + delta, maxLength);
    } else {
      const minLength = def.minRopeLength ?? DEFAULT_MIN_ROPE_LENGTH;
      nextLength = Math.max(state.currentLength - delta, minLength);
    }

    const changed = state.currentLength !== nextLength;
    if (changed) {
      state.currentLength = nextLength;
      this.playSoundSafe(player, soundId);
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
        this.handleReelInput(player, state, def);

        // 構え中（未着弾）の平行移動およびブロック接触判定
        if (state.isAnchored === false) {
          this.updateProbingState(player, state, def);
        }

        if (state.isAnchored !== false) {
          // 物理インパルス計算と適用
          const impulse = def.calculateImpulse(player, state);
          if (impulse.x !== 0 || impulse.y !== 0 || impulse.z !== 0) {
            player.applyImpulse(impulse);
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
        player.onScreenDisplay.setActionBar(
          `${distance.toFixed(1)}m / ${state.currentLength.toFixed(1)}m`,
        );
      }
      PlayerStateManager.set(player.id, UI_ACTIVE_KEY, true);
    } catch {
      // プレイヤー切断時などのエラー抑止
    }
  }
}
