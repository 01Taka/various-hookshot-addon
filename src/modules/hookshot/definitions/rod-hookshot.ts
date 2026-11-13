import { ROD_WIRE_STYLE } from "../../render";
import { calculateRodHookshot } from "../math/rod-math";
import { HookshotDefinition } from "../types";

export const ROD_HOOKSHOT_ID = "rod";
export const STICK_ITEM_ID = "minecraft:stick";

/**
 * 棒（minecraft:stick）を使用した内側にも縮まない剛体棒フックショットの定義
 * 空中ジャンプ入力で短く（shorten）、シフト入力で長く（extend）
 */
export const rodHookshotDefinition: HookshotDefinition = {
  id: ROD_HOOKSHOT_ID,
  itemTypeId: STICK_ITEM_ID,
  maxDistance: 42,
  reelSpeed: 0.9,
  reelMode: "extend",
  initialReelDelta: 0.0,
  minRopeLength: 2.0,
  allowAirProbing: true,
  probingInitialLength: 12,
  probingMinHitDistance: 1.5,
  stepReel: {
    stepLength: 2.0,
    initialIntervalTicks: 7,
    minIntervalTicks: 2,
    intervalDecayTicks: 1,
  },
  stepSoundId: "block.wood.place",
  probingHitSoundId: "block.wood.place",
  wireStyle: ROD_WIRE_STYLE,
  calculateImpulse: (player, state) => {
    return calculateRodHookshot(player, state.anchor, state.currentLength);
  },
};
