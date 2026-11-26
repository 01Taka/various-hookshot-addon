import {
  bambooHookshotDefinition,
  initBambooHookshotTracking,
} from "./bamboo/def";
import { elasticHookshotDefinition } from "./elastic/def";
import { magnetHookshotDefinition } from "./magnet/def";
import { rigidHookshotDefinition } from "./rigid/def";
import { rodHookshotDefinition } from "./rod/def";
import { springHookshotDefinition } from "./spring/def";
import { ziplineHookshotDefinition } from "./zipline/def";
import { HookshotSystem } from "./hookshot-system";

export * from "./constants";
export * from "./types";
export * from "./hookshot-system";

export * from "./bamboo/def";
export * from "./bamboo/math";
export * from "./bamboo/type";

export * from "./elastic/def";
export * from "./elastic/math";
export * from "./elastic/type";

export * from "./magnet/def";
export * from "./magnet/math";
export * from "./magnet/type";

export * from "./rigid/def";
export * from "./rigid/math";
export * from "./rigid/type";

export * from "./rod/def";
export * from "./rod/math";
export * from "./rod/type";

export * from "./spring/def";
export * from "./spring/math";
export * from "./spring/type";

export * from "./zipline/def";
export * from "./zipline/math";
export * from "./zipline/type";

export * from "./math/steering-math";
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
