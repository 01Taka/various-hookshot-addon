import {
  EntitySwingSource,
  Player,
  system,
  world,
} from "@minecraft/server";
import {
  getMainhandItem,
  isSneakButtonPressed,
  PlayerStateManager,
} from "addon-utils";
import { HookshotSystem } from "../hookshot";
import { PATHFINDER_ITEM_ID } from "../pathfinder-grapple";

/** 爆発サポートが無効化されていることを示すプレイヤータグ */
export const EXPLOSION_DISABLED_TAG = "hookshot:explosion_disabled";

/** 爆発サポートの前回実行Tick保存キー */
const EXPLOSION_SUPPORT_LAST_TICK_KEY = "explosionSupportLastTick";

/** 設定トグルの前回実行Tick保存キー（誤連打防止） */
const EXPLOSION_TOGGLE_LAST_TICK_KEY = "explosionToggleLastTick";

/** 1秒のインターバル (Minecraftは20 ticks/秒) */
export const EXPLOSION_SUPPORT_COOLDOWN_TICKS = 20;

/** 設定トグルのクールダウン (0.5秒 = 10 ticks) */
const TOGGLE_COOLDOWN_TICKS = 10;

/** 浮遊効果の持続時間 (0.1秒 = 2 ticks) */
export const EXPLOSION_SUPPORT_LEVITATION_TICKS = 2;

/** 上方向のインパルス量 (blocks/tick) */
export const EXPLOSION_SUPPORT_UPWARD_IMPULSE = 0.85;

/**
 * 爆発サポートシステム
 * パスファインダーのグラップル以外のフックショット所持中に空中を左クリック（パンチ）すると、
 * 足元に爆発を起こしてy方向速度を相殺し、上方向インパルスと0.1秒の浮遊効果（落下ダメージ無効化）を付与します。
 * 1秒のクールダウン（インターバル）が適用されます。
 *
 * 【簡単なON/OFF切り替え】
 * - 地上でスニークしながら左クリック: ON/OFF を即座にトグル
 * - `/scriptevent hookshot:explosion` : コマンドでトグル (on/off/menu)
 */
export class ExplosionSupportSystem {
  private static isInitialized = false;

  /**
   * システムの初期化とイベント購読
   */
  public static init(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    world.afterEvents.playerSwingStart.subscribe((event) => {
      this.handleSwing(
        event.player,
        event.swingSource,
        event.heldItemStack?.typeId,
      );
    });
  }

  /**
   * プレイヤーの爆発サポートが有効かどうかを返します（デフォルト: true）
   */
  public static isEnabled(player: Player): boolean {
    if (!player.isValid) return false;
    return !player.hasTag(EXPLOSION_DISABLED_TAG);
  }

  /**
   * プレイヤーの爆発サポートの有効/無効を設定します
   */
  public static setEnabled(player: Player, enabled: boolean): void {
    if (!player.isValid) return;
    if (enabled) {
      if (player.hasTag(EXPLOSION_DISABLED_TAG)) {
        player.removeTag(EXPLOSION_DISABLED_TAG);
      }
    } else {
      if (!player.hasTag(EXPLOSION_DISABLED_TAG)) {
        player.addTag(EXPLOSION_DISABLED_TAG);
      }
    }
  }

  /**
   * プレイヤーの爆発サポートの有効/無効を切り替えます
   * @returns 切り替え後の有効状態 (true: ON, false: OFF)
   */
  public static toggleEnabled(player: Player): boolean {
    const nextState = !this.isEnabled(player);
    this.setEnabled(player, nextState);
    return nextState;
  }

  /**
   * スイング（左クリックパンチ）検知ハンドラ
   */
  private static handleSwing(
    player: Player,
    swingSource: EntitySwingSource,
    heldItemTypeId?: string,
  ): void {
    if (!player.isValid) return;

    // 左クリック攻撃・空振りスイング以外（ブロック採掘、アイテム使用等）は除外
    if (
      swingSource !== EntitySwingSource.Attack &&
      swingSource !== EntitySwingSource.None
    ) {
      return;
    }

    // 手持ちアイテムの判定（イベントのheldItemStackまたはメインハンド）
    const itemTypeId = heldItemTypeId ?? getMainhandItem(player)?.typeId;
    if (!itemTypeId) return;

    // パスファインダーのグラップルは除外
    if (itemTypeId === PATHFINDER_ITEM_ID) {
      return;
    }

    // パスファインダー以外の登録フックショットか判定
    if (!HookshotSystem.isHookshotItem(itemTypeId)) {
      return;
    }

    const currentTick = system.currentTick;

    // --- 簡単ON/OFFトグル操作 ---
    // 地上でスニークしながら左クリックした場合は、爆発を起こさず設定を即座にトグル
    let isSneaking = false;
    try {
      isSneaking = isSneakButtonPressed(player);
    } catch {}

    if (player.isOnGround && isSneaking) {
      const lastToggleTick = PlayerStateManager.get<number>(
        player.id,
        EXPLOSION_TOGGLE_LAST_TICK_KEY,
        -9999,
      );
      if (currentTick - lastToggleTick < TOGGLE_COOLDOWN_TICKS) {
        return;
      }
      PlayerStateManager.set(
        player.id,
        EXPLOSION_TOGGLE_LAST_TICK_KEY,
        currentTick,
      );

      const newState = this.toggleEnabled(player);
      if (newState) {
        player.sendMessage("§a[爆発サポート] §lON§r§a (有効) に切り替えました。");
        player.onScreenDisplay.setActionBar("§a爆発サポート: ON");
        player.playSound("random.orb", { pitch: 1.5 });
      } else {
        player.sendMessage("§c[爆発サポート] §lOFF§r§c (無効) に切り替えました。");
        player.onScreenDisplay.setActionBar("§c爆発サポート: OFF");
        player.playSound("random.orb", { pitch: 0.8 });
      }
      return;
    }

    // --- 爆発サポート発動処理 ---
    // プレイヤーが爆発サポートをOFFに設定している場合はスキップ
    if (!this.isEnabled(player)) {
      return;
    }

    // 1秒 (20 ticks) のインターバル判定
    const lastTick = PlayerStateManager.get<number>(
      player.id,
      EXPLOSION_SUPPORT_LAST_TICK_KEY,
      -9999,
    );
    if (currentTick - lastTick < EXPLOSION_SUPPORT_COOLDOWN_TICKS) {
      return;
    }

    // 実行記録（インターバル開始）
    PlayerStateManager.set(
      player.id,
      EXPLOSION_SUPPORT_LAST_TICK_KEY,
      currentTick,
    );

    // 爆発サポート発動
    this.executeExplosionSupport(player);
  }

  /**
   * 爆発サポートを実行
   */
  private static executeExplosionSupport(player: Player): void {
    const loc = player.location;
    const dimension = player.dimension;

    // 1. 足元に爆発パーティクルと爆発音を生成
    try {
      dimension.spawnParticle("minecraft:huge_explosion_emitter", loc);
      dimension.playSound("random.explode", loc, {
        volume: 0.9,
        pitch: 1.2,
      });
    } catch {
      // パーティクル・サウンド再生時のエラー抑止
    }

    // 2. y方向の速度を打ち消し、上方向のインパルスを付与
    try {
      const currentVelocity = player.getVelocity();
      // 現在の落下・上昇速度を相殺し、指定の上方向インパルスを追加
      const impulseY = -currentVelocity.y + EXPLOSION_SUPPORT_UPWARD_IMPULSE;
      player.applyImpulse({ x: 0, y: impulseY, z: 0 });
    } catch {
      // applyImpulse 失敗時のフォールバック
    }

    // 3. 浮遊効果を0.1秒 (2 ticks) 付与して落下ダメージを無効化
    try {
      player.addEffect("levitation", EXPLOSION_SUPPORT_LEVITATION_TICKS, {
        amplifier: 0,
        showParticles: false,
      });
    } catch {
      // エフェクト付与失敗時のエラー抑止
    }
  }
}
