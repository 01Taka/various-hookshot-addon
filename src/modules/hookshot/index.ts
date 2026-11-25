import {
  bambooHookshotDefinition,
  initBambooHookshotTracking,
} from "./definitions/bamboo-hookshot";
import { elasticHookshotDefinition } from "./definitions/elastic-hookshot";
import { magnetHookshotDefinition } from "./definitions/magnet-hookshot";
import { rigidHookshotDefinition } from "./definitions/rigid-hookshot";
import { rodHookshotDefinition } from "./definitions/rod-hookshot";
import { springHookshotDefinition } from "./definitions/spring-hookshot";
import { ziplineHookshotDefinition } from "./definitions/zipline-hookshot";
import { HookshotSystem } from "./hookshot-system";

export * from "./constants";
export * from "./types";
export * from "./hookshot-system";
export * from "./definitions";
export * from "./math/bamboo-math";
export * from "./math/elastic-math";
export * from "./math/magnet-math";
export * from "./math/rigid-math";
export * from "./math/rod-math";
export * from "./math/spring-math";
export * from "./math/steering-math";
export * from "./math/zipline-math";
export * from "./math/physics-utils";

/**
 * 通常フックショットシステムを標準定義（リード、糸、棒、スライムボール、竹、ジップライン）とともに初期化します。
 */
export function initHookshotSystem(): void {
  initBambooHookshotTracking();
  HookshotSystem.register(bambooHookshotDefinition);
  HookshotSystem.register(elasticHookshotDefinition);
  HookshotSystem.register(magnetHookshotDefinition);
  HookshotSystem.register(rigidHookshotDefinition);
  HookshotSystem.register(rodHookshotDefinition);
  HookshotSystem.register(springHookshotDefinition);
  HookshotSystem.register(ziplineHookshotDefinition);
  HookshotSystem.init();
}
