import { RIGID_WIRE_STYLE } from "../../render";
import { calculateRigidHookshot } from "../math/rigid-math";
import { HookshotDefinition } from "../types";

export const RIGID_HOOKSHOT_ID = "rigid";
export const STRING_ITEM_ID = "minecraft:string";

/**
 * 糸（minecraft:string）を使用した伸びがない（剛体ロープ）フックショットの定義
 * 空中ジャンプ入力で短く（shorten）、シフト入力で長く（extend）
 * 空中ジャンプ短縮＋横向き視線でパスファインダー型スリングショット旋回軌道に対応
 */
export const rigidHookshotDefinition: HookshotDefinition = {
  id: RIGID_HOOKSHOT_ID,
  itemTypeId: STRING_ITEM_ID,
  maxDistance: 200,
  reelSpeed: 2.0,
  reelMode: "shorten",
  initialReelDelta: 0.0,
  minRopeLength: 1.5,
  wireStyle: RIGID_WIRE_STYLE,
  enableGazeSteering: true,
  enablePostFlight: true,
  calculateImpulse: (player, state) => {
    return calculateRigidHookshot(player, state.anchor, state.currentLength, {
      isReelingIn: state.isReelingIn,
      enableSteering: true,
    });
  },
};
