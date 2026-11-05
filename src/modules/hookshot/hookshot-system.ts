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
import { AnchorPosition, HookshotDefinition, HookshotState } from "./types";

const ACTIVE_HOOK_KEY = "hookshotActiveState";
const LAST_USE_TICK_KEY = "hookshotLastUseTick";
const UI_ACTIVE_KEY = "hookshotUiActive";

const DEFAULT_MAX_DISTANCE = 1200;
const DEFAULT_REEL_SPEED = 1.25;
const DEFAULT_MIN_ROPE_LENGTH = 1.5;

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
    const maxDistance = def.maxDistance ?? DEFAULT_MAX_DISTANCE;

    const hit = player.getBlockFromViewDirection({
      maxDistance,
      includeLiquidBlocks: false,
      includePassableBlocks: false,
    });
    if (!hit) {
      return false;
    }

    // 外部の特殊フックショット（パスファインダー等）が動作中なら解除を通知
    for (const handler of this.externalUnhookHandlers) {
      handler(player);
    }

    const normal = getDirectionVector(hit.face);
    const anchor = this.calculateAnchorPosition(player, hit, normal);
    const distance = Vector3Utils.distance(player.location, anchor);

    const state: HookshotState = {
      hookshotId: def.id,
      anchor,
      normal,
      currentLength: distance,
      jumpConsumed:
        isInputButtonPressed(player, "Jump") || player.isJumping,
      sneakConsumed: isSneakButtonPressed(player),
    };

    PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);

    if (def.onAttach) {
      def.onAttach(player, state);
    }

    return true;
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
      if (stateDirty) {
        PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
      }
      return;
    }

    const baseMode = def.reelMode ?? "shorten";
    const reverseMode = baseMode === "extend" ? "shorten" : "extend";

    // シフト（スニーク）は地上・空中のどちらでも逆方向（長くする）に動作
    if (sneakPressed) {
      const isInitial = !state.sneakConsumed;
      if (isInitial) {
        state.sneakConsumed = true;
        stateDirty = true;
      }
      this.reel(player, state, def, reverseMode, isInitial, stateDirty);
      return;
    }

    // ジャンプは空中時のみ通常方向（短くする）に動作
    if (jumpPressed && !onGround) {
      const isInitial = !state.jumpConsumed;
      if (isInitial) {
        state.jumpConsumed = true;
        stateDirty = true;
      }
      this.reel(player, state, def, baseMode, isInitial, stateDirty);
      return;
    }

    if (stateDirty) {
      PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
    }
  }

  /**
   * ロープの長さ変更処理（短縮または伸長）
   */
  private static reel(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
    mode: "shorten" | "extend",
    isInitial = false,
    forceSave = false,
  ): void {
    const reelSpeed = def.reelSpeed ?? DEFAULT_REEL_SPEED;
    const configuredInitial =
      typeof def.initialReelDelta === "object"
        ? mode === "extend"
          ? def.initialReelDelta.extend
          : def.initialReelDelta.shorten
        : def.initialReelDelta;

    const initialStep = isInitial ? (configuredInitial ?? 0) : 0;
    const delta = reelSpeed + initialStep;

    let nextLength = state.currentLength;
    if (mode === "extend") {
      const maxLength =
        def.maxRopeLength ?? def.maxDistance ?? DEFAULT_MAX_DISTANCE;
      nextLength = Math.min(state.currentLength + delta, maxLength);
    } else {
      const minLength = def.minRopeLength ?? DEFAULT_MIN_ROPE_LENGTH;
      nextLength = Math.max(state.currentLength - delta, minLength);
    }

    if (state.currentLength !== nextLength || forceSave) {
      state.currentLength = nextLength;
      PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
    }
  }

  /**
   * システム初期化・イベント購読開始
   */
  public static init(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

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

        // 物理インパルス計算と適用
        const impulse = def.calculateImpulse(player, state);
        if (impulse.x !== 0 || impulse.y !== 0 || impulse.z !== 0) {
          player.applyImpulse(impulse);
        }

        // ワイヤーの描画
        HookRenderManager.renderHookshot(
          player,
          state.anchor,
          state.hookshotId,
          def.wireStyle,
          state.currentLength,
          state.normal,
        );

        // 接続中距離UIの更新（○○m / ○○m）
        this.updateDistanceUi(player, state);
      }
    });
  }

  /**
   * レイキャスト衝突結果からアンカー座標を計算します。
   */
  private static calculateAnchorPosition(
    player: Player,
    hit: BlockRaycastHit,
    normal: Vector3 = getDirectionVector(hit.face),
  ): AnchorPosition {
    const head = player.getHeadLocation();
    const view = player.getViewDirection();

    // 衝突面の中心座標
    const faceCenterX = hit.block.x + 0.5 + normal.x * 0.5;
    const faceCenterY = hit.block.y + 0.5 + normal.y * 0.5;
    const faceCenterZ = hit.block.z + 0.5 + normal.z * 0.5;

    // レイと平面の交点距離 t
    const dot = normal.x * view.x + normal.y * view.y + normal.z * view.z;
    let anchorX = faceCenterX;
    let anchorY = faceCenterY;
    let anchorZ = faceCenterZ;

    if (Math.abs(dot) > 0.0001) {
      const t =
        (normal.x * (faceCenterX - head.x) +
          normal.y * (faceCenterY - head.y) +
          normal.z * (faceCenterZ - head.z)) /
        dot;

      if (t > 0) {
        // 交点座標をブロック面の境界内 [0, 1] にクランプ
        anchorX = Math.max(
          hit.block.x,
          Math.min(hit.block.x + 1, head.x + view.x * t),
        );
        anchorY = Math.max(
          hit.block.y,
          Math.min(hit.block.y + 1, head.y + view.y * t),
        );
        anchorZ = Math.max(
          hit.block.z,
          Math.min(hit.block.z + 1, head.z + view.z * t),
        );
      }
    }

    return {
      dimensionId: player.dimension.id,
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

    const anchor = this.calculateAnchorPosition(player, hit);
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
  ): void {
    try {
      const distance = Vector3Utils.distance(player.location, state.anchor);
      player.onScreenDisplay.setActionBar(
        `${distance.toFixed(1)}m / ${state.currentLength.toFixed(1)}m`,
      );
      PlayerStateManager.set(player.id, UI_ACTIVE_KEY, true);
    } catch {
      // プレイヤー切断時などのエラー抑止
    }
  }
}
