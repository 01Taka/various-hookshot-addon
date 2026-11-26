import {
  bambooHookshotDefinition,
  initBambooHookshotTracking,
} from "./hooks/bamboo";
import { elasticHookshotDefinition } from "./hooks/elastic";
import { magnetHookshotDefinition } from "./hooks/magnet";
import { rigidHookshotDefinition } from "./hooks/rigid";
import { rodHookshotDefinition } from "./hooks/rod";
import { springHookshotDefinition } from "./hooks/spring";
import { ziplineHookshotDefinition } from "./hooks/zipline";
import { HookshotSystem } from "./hookshot-system";

export * from "./constants";
export * from "./types";
export * from "./hookshot-system";

export * from "./hooks/bamboo";
export * from "./hooks/elastic";
export * from "./hooks/magnet";
export * from "./hooks/rigid";
export * from "./hooks/rod";
export * from "./hooks/spring";
export * from "./hooks/zipline";

export * from "./math/steering-math";
export * from "./math/physics-utils";

/**
 * フックショットシステムを標準定義とともに初期化します。
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
