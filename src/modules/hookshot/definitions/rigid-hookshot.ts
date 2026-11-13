import { RIGID_WIRE_STYLE } from "../../render";
import { calculateRigidHookshot } from "../math/rigid-math";
import { HookshotDefinition } from "../types";

export const RIGID_HOOKSHOT_ID = "rigid";
export const STRING_ITEM_ID = "various_hookshot_addon:rigid_hookshot";

/**
 * 糸（minecraft:string）を使用した伸びがない（剛体ロープ）フックショットの定義
 * 空中ジャンプ入力で短く（shorten）、シフト入力で長く（extend）
 * 空中ジャンプ短縮＋横向き視線でパスファインダー型スリングショット旋回軌道に対応
 */
export const rigidHookshotDefinition: HookshotDefinition = {
  id: RIGID_HOOKSHOT_ID,
  itemTypeId: STRING_ITEM_ID,
  maxDistance: 200,
  reel: {
    mode: "continuous",
    speed: 2.0,
    initialDelta: 0.0,
    soundId: "step.chain",
    soundIntervalTicks: 4,
  },
  reelMode: "shorten",
  minRopeLength: 1.5,
  raycastGraceTicks: 10,
  shotSoundId: "crossbow.shoot",
  hitSoundId: "place.chain",
  wireStyle: RIGID_WIRE_STYLE,
  enableGazeSteering: true,
  calculateImpulse: (player, state) => {
    return calculateRigidHookshot(player, state.anchor, state.currentLength, {
      isReelingIn: state.isReelingIn,
      enableSteering: true,
    });
  },
};
