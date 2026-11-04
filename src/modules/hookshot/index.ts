import { elasticHookshotDefinition } from "./definitions/elastic-hookshot";
import { rigidHookshotDefinition } from "./definitions/rigid-hookshot";
import { rodHookshotDefinition } from "./definitions/rod-hookshot";
import { springHookshotDefinition } from "./definitions/spring-hookshot";
import { HookshotSystem } from "./hookshot-system";

export * from "./types";
export * from "./hookshot-system";
export * from "./definitions";
export * from "./math/elastic-math";
export * from "./math/rigid-math";
export * from "./math/rod-math";
export * from "./math/spring-math";
export * from "./math/physics-utils";

/**
 * 通常フックショットシステムを標準定義（リード、糸、棒、スライムボール）とともに初期化します。
 */
export function initHookshotSystem(): void {
  HookshotSystem.register(elasticHookshotDefinition);
  HookshotSystem.register(rigidHookshotDefinition);
  HookshotSystem.register(rodHookshotDefinition);
  HookshotSystem.register(springHookshotDefinition);
  HookshotSystem.init();
}
