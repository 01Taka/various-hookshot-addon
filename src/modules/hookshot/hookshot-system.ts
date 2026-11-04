import { Vector3Utils } from "@minecraft/math";
import { Player, system, world } from "@minecraft/server";
import { isSneakButtonPressed, PlayerStateManager } from "addon-utils";
import { AnchorPosition, HookshotDefinition, HookshotState } from "./types";

const ACTIVE_HOOK_KEY = "hookshotActiveState";
const LAST_USE_TICK_KEY = "hookshotLastUseTick";

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

    const anchor: AnchorPosition = {
      dimensionId: player.dimension.id,
      x: hit.block.x + 0.5,
      y: hit.block.y + 0.5,
      z: hit.block.z + 0.5,
    };

    const distance = Vector3Utils.distance(player.location, anchor);

    const state: HookshotState = {
      hookshotId: def.id,
      anchor,
      currentLength: distance,
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
   * ロープ巻き取り処理
   */
  private static reel(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
  ): void {
    const reelSpeed = def.reelSpeed ?? DEFAULT_REEL_SPEED;
    const minLength = def.minRopeLength ?? DEFAULT_MIN_ROPE_LENGTH;

    const nextLength = Math.max(state.currentLength - reelSpeed, minLength);
    if (state.currentLength !== nextLength) {
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
        if (!state) continue;

        // ディメンションが変化した場合は自動解除
        if (player.dimension.id !== state.anchor.dimensionId) {
          this.unhook(player);
          continue;
        }

        const def = this.definitionsById.get(state.hookshotId);
        if (!def) continue;

        // スニークによる巻き取り
        if (isSneakButtonPressed(player)) {
          this.reel(player, state, def);
        }

        // 物理インパルス計算と適用
        const impulse = def.calculateImpulse(player, state);
        if (impulse.x !== 0 || impulse.y !== 0 || impulse.z !== 0) {
          player.applyImpulse(impulse);
        }
      }
    });
  }
}
