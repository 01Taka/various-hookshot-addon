import { elasticHookshotDefinition } from "./definitions/elastic-hookshot";
import { rigidHookshotDefinition } from "./definitions/rigid-hookshot";
import { HookshotSystem } from "./hookshot-system";

export * from "./types";
export * from "./hookshot-system";
export * from "./definitions";
export * from "./math/elastic-math";
export * from "./math/rigid-math";
export * from "./math/physics-utils";

/**
 * フックショットシステムを標準定義（リード、糸）とともに初期化します。
 */
export function initHookshotSystem(): void {
  HookshotSystem.register(elasticHookshotDefinition);
  HookshotSystem.register(rigidHookshotDefinition);
  HookshotSystem.init();
}
