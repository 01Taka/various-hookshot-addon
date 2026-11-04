import { PathfinderGrappleSystem } from "./grapple-system";

export * from "./types";
export * from "./physics";
export * from "./grapple-system";

/**
 * パスファインダー型グラップル（独立モジュール）を初期化します。
 */
export function initPathfinderGrapple(): void {
  PathfinderGrappleSystem.init();
}
