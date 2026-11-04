import { calculateRigidHookshot } from "../math/rigid-math";
import { HookshotDefinition } from "../types";

export const RIGID_HOOKSHOT_ID = "rigid";
export const STRING_ITEM_ID = "minecraft:string";

/**
 * 糸（minecraft:string）を使用した伸びがない（剛体ロープ）フックショットの定義
 */
export const rigidHookshotDefinition: HookshotDefinition = {
  id: RIGID_HOOKSHOT_ID,
  itemTypeId: STRING_ITEM_ID,
  maxDistance: 1200,
  reelSpeed: 1.25,
  minRopeLength: 1.5,
  calculateImpulse: (player, state) => {
    return calculateRigidHookshot(player, state.anchor, state.currentLength);
  },
};
