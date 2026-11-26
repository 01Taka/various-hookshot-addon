import { BurstChargeSystem } from "./burst-charge-system";

export * from "./burst-charge-system";

/**
 * バーストチャージシステムを初期化します。
 */
export function initBurstChargeSystem(): void {
  BurstChargeSystem.init();
}
