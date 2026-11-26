import { AeroVestSystem } from "./aero-vest";
import { initBurstChargeSystem } from "./burst-charge";

export * from "./aero-vest";
export * from "./burst-charge";

/**
 * 補助アイテムシステム一式（エアロベスト・バーストチャージ）を初期化します。
 */
export function initSubItems(): void {
  AeroVestSystem.init();
  initBurstChargeSystem();
}
