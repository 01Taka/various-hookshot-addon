import { rodHookshotConfig } from "./config";
import { calculateRodHookshot } from "./math";
import { RodHookshotDefinition } from "./type";

export * from "./type";
export * from "./config";
export * from "./math";

/**
 * 棒（minecraft:stick）を使用した内側にも縮まない剛体棒フックショットの定義
 * 空中ジャンプ入力で短く（shorten）、シフト入力で長く（extend）
 */
export const rodHookshotDefinition: RodHookshotDefinition = {
  ...rodHookshotConfig,
  calculateImpulse: (player, state) => {
    return calculateRodHookshot(
      player,
      state.anchor,
      state.currentLength,
      rodHookshotConfig.baumgarteFactor ?? 0.15,
    );
  },
};
