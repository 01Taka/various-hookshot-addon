import {
  EntityComponentTypes,
  EntitySwingSource,
  EquipmentSlot,
  GameMode,
  Player,
  world,
} from "@minecraft/server";
import { getMainhandItem } from "addon-utils";
import { HookshotSystem } from "../../hookshot";

/** バーストチャージ用消費アイテムID */
export const BURST_CHARGE_ITEM_ID = "various_hookshot_addon:burst_charge";

/** ネイティブクールダウンカテゴリ */
export const BURST_CHARGE_COOLDOWN_CATEGORY = "burst_charge";

/** 0.85秒のインターバル (Minecraftは20 ticks/秒 -> 17 ticks) */
export const BURST_CHARGE_COOLDOWN_TICKS = 17;

/** 浮遊効果の持続時間 (0.1秒 = 2 ticks) */
export const BURST_CHARGE_LEVITATION_TICKS = 2;

/** 上方向のインパルス量 (blocks/tick) */
export const BURST_CHARGE_UPWARD_IMPULSE = 0.85;

/**
 * バーストチャージシステム
 * - 単体使用: メインハンドにバーストチャージを持って右クリックで1個消費して発動
 * - オフハンド併用: オフハンドにバーストチャージを持ち、メインハンドにフックショットまたは素手で左クリックすると1個消費して発動
 * 1秒のクールダウン（インターバル）が適用されます。クリエイティブモードでは消費しません。
 */
export class BurstChargeSystem {
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
      if (event.itemStack.typeId !== BURST_CHARGE_ITEM_ID) return;

      this.tryTriggerBurst(
        player as Player,
        EquipmentSlot.Mainhand,
        BURST_CHARGE_ITEM_ID,
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

    if (
      swingSource !== EntitySwingSource.Attack &&
      swingSource !== EntitySwingSource.Mine &&
      swingSource !== EntitySwingSource.None
    ) {
      return;
    }

    const itemTypeId = heldItemTypeId ?? getMainhandItem(player)?.typeId;
    const isBareHand = !itemTypeId || itemTypeId === "minecraft:air";

    if (!isBareHand && !HookshotSystem.isHookshotItem(itemTypeId)) {
      return;
    }

    const equippable = player.getComponent(EntityComponentTypes.Equippable);
    const offhandItem = equippable?.getEquipment(EquipmentSlot.Offhand);
    if (!offhandItem || offhandItem.typeId !== BURST_CHARGE_ITEM_ID) {
      return;
    }

    this.tryTriggerBurst(player, EquipmentSlot.Offhand, BURST_CHARGE_ITEM_ID);
  }

  /**
   * クールダウン判定とアイテム消費を行い、バーストチャージを発動します
   */
  private static tryTriggerBurst(
    player: Player,
    slot: EquipmentSlot,
    expectedItemTypeId: string,
  ): void {
    if (!player.isValid) return;

    if (player.getItemCooldown(BURST_CHARGE_COOLDOWN_CATEGORY) > 0) {
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

    player.startItemCooldown(
      BURST_CHARGE_COOLDOWN_CATEGORY,
      BURST_CHARGE_COOLDOWN_TICKS,
    );

    this.executeBurst(player, consumeResult.remainingAmount);
  }

  /**
   * 指定スロットのアイテムを1個消費し、消費成否と消費後の残り個数を返します
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
   * バーストチャージを実行
   */
  private static executeBurst(player: Player, remainingAmount: number): void {
    HookshotSystem.unhook(player);

    const loc = player.location;
    const dimension = player.dimension;

    try {
      dimension.spawnParticle("minecraft:huge_explosion_emitter", loc);
      dimension.playSound("random.explode", loc, {
        volume: 0.9,
        pitch: 1.2,
      });

      if (remainingAmount === 0) {
        player.playSound("random.break", { volume: 1.0, pitch: 0.9 });
        player.playSound("note.bass", { volume: 1.0, pitch: 0.6 });
      } else if (remainingAmount <= 3) {
        const pitch = 1.0 + (3 - remainingAmount) * 0.25;
        player.playSound("note.pling", { volume: 1.0, pitch });
      }
    } catch {}

    try {
      const currentVelocity = player.getVelocity();
      const impulseY = -currentVelocity.y + BURST_CHARGE_UPWARD_IMPULSE;
      player.applyImpulse({ x: 0, y: impulseY, z: 0 });
    } catch {}

    try {
      player.addEffect("levitation", BURST_CHARGE_LEVITATION_TICKS, {
        amplifier: 0,
        showParticles: false,
      });
    } catch {}
  }
}
