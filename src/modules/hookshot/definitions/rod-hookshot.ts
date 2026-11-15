import { ROD_WIRE_STYLE } from "../../render";
import { calculateRodHookshot } from "../math/rod-math";
import {
  AirProbingCapable,
  AirProbingState,
  BaseHookshotDefinition,
  BaseHookshotState,
  RetractCapable,
  RetractState,
  StepReelState,
} from "../types";

export const ROD_HOOKSHOT_ID = "rod";
export const STICK_ITEM_ID = "various_hookshot_addon:rod_hookshot";

export interface RodHookshotState
  extends BaseHookshotState<typeof ROD_HOOKSHOT_ID>,
    AirProbingState,
    RetractState,
    StepReelState {}

export interface RodHookshotDefinition
  extends BaseHookshotDefinition<typeof ROD_HOOKSHOT_ID, RodHookshotState>,
    AirProbingCapable,
    RetractCapable {}

/**
 * 棒（minecraft:stick）を使用した内側にも縮まない剛体棒フックショットの定義
 * 空中ジャンプ入力で短く（shorten）、シフト入力で長く（extend）
 */
export const rodHookshotDefinition: RodHookshotDefinition = {
  id: ROD_HOOKSHOT_ID,
  itemTypeId: STICK_ITEM_ID,
  maxDistance: 42,
  reel: {
    mode: "step",
    stepLength: 2.0,
    initialIntervalTicks: 7,
    minIntervalTicks: 2,
    intervalDecayTicks: 1,
    soundId: "place.wood",
  },
  reelMode: "extend",
  minRopeLength: 2.0,
  shotSoundId: "step.wood",
  airProbing: {
    initialLength: 2.0,
    extend: {
      mode: "step",
      stepLength: 4.0,
      intervalTicks: 1,
      soundId: "place.wood",
    },
    minHitDistance: 1.5,
    hitSoundId: "place.wood",
  },
  retract: {
    mode: "step",
    stepLength: 2.0,
    intervalTicks: 1,
    soundId: "place.wood",
  },
  wireStyle: ROD_WIRE_STYLE,
  calculateImpulse: (player, state) => {
    return calculateRodHookshot(player, state.anchor, state.currentLength);
  },
};
