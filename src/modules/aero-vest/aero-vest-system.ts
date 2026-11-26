import {
  EquipmentSlot,
  ItemComponentTypes,
  ItemDurabilityComponent,
  ItemStack,
  Player,
} from "@minecraft/server";
import {
  getEnchantmentLevel,
  getEquipmentItem,
  getEquippableComponent,
  getItemDurability,
  ItemDurability,
} from "addon-utils";
import { InertiaFlightOptions, InertiaFlightSystem } from "../inertia-flight";
import {
  AERO_VEST_DURABILITY_INTERVAL_TICKS,
  AERO_VEST_INERTIA_CONFIGS,
} from "./config";

export interface EquippedVestInfo {
  item: ItemStack;
  options: InertiaFlightOptions;
  durability: ItemDurability | null;
}

export class AeroVestSystem {
  private static isInitialized = false;

  /**
   * エアロベストシステムを初期化し、慣性飛行プロバイダを登録します。
   */
  public static init(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    InertiaFlightSystem.init();
    InertiaFlightSystem.registerProvider((player) => {
      const vestInfo = this.getEquippedVestInfo(player);
      if (!vestInfo) return null;

      return {
        providerId: vestInfo.item.typeId,
        options: vestInfo.options,
        onTickActive: (activePlayer, activeFlightTicks) => {
          if (activeFlightTicks % AERO_VEST_DURABILITY_INTERVAL_TICKS === 0) {
            this.consumeVestDurability(activePlayer, vestInfo.item);
          }
        },
      };
    });
  }

  /**
   * プレイヤーが有効なエアロベストを装備しているか（残り耐久 > 1）を返します。
   */
  public static getEquippedVestInfo(player: Player): EquippedVestInfo | null {
    if (!player.isValid) return null;
    const chestItem = getEquipmentItem(player, EquipmentSlot.Chest);
    if (!chestItem) return null;

    const options = AERO_VEST_INERTIA_CONFIGS[chestItem.typeId];
    if (!options) return null;

    const durability = getItemDurability(chestItem);
    // エリトラ仕様: 残り耐久が 1（damage >= maxDurability - 1）の場合は機能停止
    if (durability && durability.damage >= durability.maxDurability - 1) {
      return null;
    }

    return { item: chestItem, options, durability };
  }

  /**
   * チェストプレートの耐久値を 1 消費します（耐久力エンチャント考慮、残り耐久 1 で停止）。
   */
  private static consumeVestDurability(player: Player, item: ItemStack): void {
    try {
      const durabilityComp = item.getComponent(
        ItemComponentTypes.Durability,
      ) as ItemDurabilityComponent | undefined;
      if (!durabilityComp) return;

      const maxStopDamage = durabilityComp.maxDurability - 1;
      if (durabilityComp.damage >= maxStopDamage) return;

      const unbreakingLevel = getEnchantmentLevel(item, "unbreaking");
      if (
        unbreakingLevel > 0 &&
        Math.random() >= 1 / (unbreakingLevel + 1)
      ) {
        return;
      }

      durabilityComp.damage = Math.min(durabilityComp.damage + 1, maxStopDamage);
      getEquippableComponent(player)?.setEquipment(EquipmentSlot.Chest, item);

      if (durabilityComp.damage >= maxStopDamage) {
        try {
          player.playSound("random.break", { volume: 0.7, pitch: 1.0 });
        } catch {}
      }
    } catch {}
  }
}
