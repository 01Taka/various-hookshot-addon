import {
  EntityComponentTypes,
  EntitySwingSource,
  EquipmentSlot,
  GameMode,
  Player,
  system,
  world,
} from "@minecraft/server";
import { getMainhandItem, PlayerStateManager } from "addon-utils";
import { HookshotSystem } from "../hookshot";
import { PATHFINDER_ITEM_ID } from "../pathfinder-grapple";

/** 爆発サポート用消費アイテムID */
export const EXPLOSION_ITEM_ID = "various_hookshot_addon:burst_charge";

/** 爆発サポートの前回実行Tick保存キー */
const EXPLOSION_SUPPORT_LAST_TICK_KEY = "explosionSupportLastTick";

/** 1秒のインターバル (Minecraftは20 ticks/秒) */
export const EXPLOSION_SUPPORT_COOLDOWN_TICKS = 20;

/** 浮遊効果の持続時間 (0.1秒 = 2 ticks) */
export const EXPLOSION_SUPPORT_LEVITATION_TICKS = 2;

/** 上方向のインパルス量 (blocks/tick) */
export const EXPLOSION_SUPPORT_UPWARD_IMPULSE = 0.85;

/**
 * 爆発サポートシステム
 * - 単体使用: メインハンドにバーストチャージを持って右クリックで1個消費して発動
 * - フックショット併用: オフハンドにバーストチャージ、メインハンドにフックショット（パスファインダー除く）を持って左クリックで1個消費して発動
 * 1秒のクールダウン（インターバル）が適用されます。クリエイティブモードでは消費しません。
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

    world.afterEvents.itemUse.subscribe((event) => {
      const player = event.source;
      if (!player || player.typeId !== "minecraft:player") return;
      if (event.itemStack.typeId !== EXPLOSION_ITEM_ID) return;

      this.tryTriggerExplosion(
        player as Player,
        EquipmentSlot.Mainhand,
        EXPLOSION_ITEM_ID,
      );
    });
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

    // オフハンドにバーストチャージを所持している場合のみ発動
    const equippable = player.getComponent(EntityComponentTypes.Equippable);
    const offhandItem = equippable?.getEquipment(EquipmentSlot.Offhand);
    if (!offhandItem || offhandItem.typeId !== EXPLOSION_ITEM_ID) {
      return;
    }

    this.tryTriggerExplosion(player, EquipmentSlot.Offhand, EXPLOSION_ITEM_ID);
  }

  /**
   * クールダウン判定とアイテム消費を行い、爆発サポートを発動します
   */
  private static tryTriggerExplosion(
    player: Player,
    slot: EquipmentSlot,
    expectedItemTypeId: string,
  ): void {
    if (!player.isValid) return;

    const currentTick = system.currentTick;
    const lastTick = PlayerStateManager.get<number>(
      player.id,
      EXPLOSION_SUPPORT_LAST_TICK_KEY,
      -9999,
    );
    if (currentTick - lastTick < EXPLOSION_SUPPORT_COOLDOWN_TICKS) {
      return;
    }

    const consumeResult = this.consumeItemFromSlot(
      player,
      slot,
      expectedItemTypeId,
    );
    if (!consumeResult.consumed) {
      return;
    }

    PlayerStateManager.set(
      player.id,
      EXPLOSION_SUPPORT_LAST_TICK_KEY,
      currentTick,
    );

    this.executeExplosionSupport(player, consumeResult.remainingAmount);
  }

  /**
   * 指定スロットのアイテムを1個消費し、消費成否と消費後の残り個数を返します
   * （クリエイティブモード時は消費せず残数を十分大きい値として返します）
   */
  private static consumeItemFromSlot(
    player: Player,
    slot: EquipmentSlot,
    expectedItemTypeId: string,
  ): { consumed: boolean; remainingAmount: number } {
    const equippable = player.getComponent(EntityComponentTypes.Equippable);
    if (!equippable) return { consumed: false, remainingAmount: 0 };

    const item = equippable.getEquipment(slot);
    if (!item || item.typeId !== expectedItemTypeId) {
      return { consumed: false, remainingAmount: 0 };
    }

    if (player.getGameMode() === GameMode.Creative) {
      return { consumed: true, remainingAmount: Number.MAX_SAFE_INTEGER };
    }

    const remainingAmount = item.amount - 1;
    if (remainingAmount > 0) {
      item.amount = remainingAmount;
      equippable.setEquipment(slot, item);
    } else {
      equippable.setEquipment(slot, undefined);
    }
    return { consumed: true, remainingAmount };
  }

  /**
   * 爆発サポートを実行
   */
  private static executeExplosionSupport(
    player: Player,
    remainingAmount: number,
  ): void {
    // 0. 爆発した瞬間にフックショットを解除
    HookshotSystem.unhook(player);

    const loc = player.location;
    const dimension = player.dimension;

    // 1. 足元に爆発パーティクルと爆発音を生成
    try {
      dimension.spawnParticle("minecraft:huge_explosion_emitter", loc);
      dimension.playSound("random.explode", loc, {
        volume: 0.9,
        pitch: 1.2,
      });

      // 残数3個以下で危険通知音を鳴らす（3→2→1でピッチ上昇、0で弾切れ音）
      if (remainingAmount === 0) {
        player.playSound("random.break", { volume: 1.0, pitch: 0.9 });
        player.playSound("note.bass", { volume: 1.0, pitch: 0.6 });
      } else if (remainingAmount <= 3) {
        const pitch = 1.0 + (3 - remainingAmount) * 0.25;
        player.playSound("note.pling", { volume: 1.0, pitch });
      }
    } catch {
      // パーティクル・サウンド再生時のエラー抑止
    }

    // 2. y方向の速度を打ち消し、上方向のインパルスを付与
    try {
      const currentVelocity = player.getVelocity();
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
