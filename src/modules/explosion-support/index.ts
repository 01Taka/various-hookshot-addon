import { initExplosionScriptEvents } from "./explosion-settings";
import { ExplosionSupportSystem } from "./explosion-support-system";

export * from "./explosion-support-system";
export * from "./explosion-settings";

/**
 * 爆発サポートシステムおよび設定コマンド・スクリプトイベントを初期化します。
 */
export function initExplosionSupportSystem(): void {
  ExplosionSupportSystem.init();
  initExplosionScriptEvents();
}
