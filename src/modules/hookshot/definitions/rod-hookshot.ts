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
  reel: {
    mode: "step",
    stepLength: 2.0,
    initialIntervalTicks: 7,
    minIntervalTicks: 2,
    intervalDecayTicks: 1,
    soundId: "block.wood.place",
  },
  reelMode: "extend",
  minRopeLength: 2.0,
  airProbing: {
    launchMode: "on_miss",
    initialLength: 12,
    minHitDistance: 1.5,
    hitSoundId: "block.wood.place",
  },
  wireStyle: ROD_WIRE_STYLE,
  calculateImpulse: (player, state) => {
    return calculateRodHookshot(player, state.anchor, state.currentLength);
  },
};
