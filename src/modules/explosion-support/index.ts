import { ExplosionSupportSystem } from "./explosion-support-system";

export * from "./explosion-support-system";

/**
 * 爆発サポートシステムを初期化します。
 */
export function initExplosionSupportSystem(): void {
  ExplosionSupportSystem.init();
}
