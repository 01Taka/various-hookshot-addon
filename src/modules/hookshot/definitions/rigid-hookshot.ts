import { RIGID_WIRE_STYLE } from "../../render";
import { calculateRigidHookshot } from "../math/rigid-math";
import { HookshotDefinition } from "../types";

export const RIGID_HOOKSHOT_ID = "rigid";
export const STRING_ITEM_ID = "minecraft:string";

/**
 * 糸（minecraft:string）を使用した伸びがない（剛体ロープ）フックショットの定義
 * 空中ジャンプ入力でロープが縮む（shorten）
 */
export const rigidHookshotDefinition: HookshotDefinition = {
  id: RIGID_HOOKSHOT_ID,
  itemTypeId: STRING_ITEM_ID,
  maxDistance: 200,
  reelSpeed: 2.0,
  reelMode: "shorten",
  minRopeLength: 1.5,
  wireStyle: RIGID_WIRE_STYLE,
  calculateImpulse: (player, state) => {
    return calculateRigidHookshot(player, state.anchor, state.currentLength);
  },
};
