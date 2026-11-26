export * from "./hookshot-hud-system";

import { HookshotHudSystem } from "./hookshot-hud-system";

/**
 * フックショットのアクションバーHUDシステムを初期化します。
 */
export function initHookshotHudSystem(): void {
  HookshotHudSystem.init();
}
