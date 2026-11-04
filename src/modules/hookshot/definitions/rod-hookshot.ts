import { calculateRodHookshot } from "../math/rod-math";
import { HookshotDefinition } from "../types";

export const ROD_HOOKSHOT_ID = "rod";
export const STICK_ITEM_ID = "minecraft:stick";

/**
 * 棒（minecraft:stick）を使用した内側にも縮まない剛体棒フックショットの定義
 */
export const rodHookshotDefinition: HookshotDefinition = {
  id: ROD_HOOKSHOT_ID,
  itemTypeId: STICK_ITEM_ID,
  maxDistance: 1200,
  reelSpeed: 1.25,
  minRopeLength: 1.5,
  calculateImpulse: (player, state) => {
    return calculateRodHookshot(player, state.anchor, state.currentLength);
  },
};
