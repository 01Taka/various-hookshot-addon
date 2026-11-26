import { BAMBOO_WIRE_STYLE } from "../../../render";
import { BAMBOO_HOOKSHOT_ID, BambooHookshotDefinition } from "./type";

export const BAMBOO_ITEM_ID = "various_hookshot_addon:bamboo_hookshot";
export const BAMBOO_AIR_CHAIN_KEY = "bambooAirChainState";

export const bambooHookshotConfig: Omit<
  BambooHookshotDefinition,
  "calculateImpulse"
> = {
  id: BAMBOO_HOOKSHOT_ID,
  itemTypeId: BAMBOO_ITEM_ID,
  maxDistance: 40,
  reel: {
    mode: "step",
    stepLength: 2.0,
    initialIntervalTicks: 7,
    minIntervalTicks: 2,
    intervalDecayTicks: 1,
    soundId: "block.bamboo.place",
  },
  reelMode: "extend",
  minRopeLength: 2.0,
  maxOverstretchDistance: 2.5,
  shotSoundId: "block.bamboo.step",
  detachSoundId: "block.bamboo.break",
  airProbing: {
    initialLength: 2.0,
    extend: {
      mode: "step",
      stepLength: 4.0,
      intervalTicks: 1,
      soundId: "block.bamboo.place",
    },
    minHitDistance: 1.5,
    hitSoundId: "block.bamboo.place",
  },
  retract: {
    mode: "step",
    stepLength: 2.0,
    intervalTicks: 1,
    soundId: "block.bamboo.place",
  },
  wireStyle: BAMBOO_WIRE_STYLE,
  physics: {
    flexibility: 1.0,
    baseStiffnessFactor: 0.14,
    maxCompression: 5.0,
    tangentTransferRatio: 0.7,
    damping: 0.02,
    maxAcceleration: 12,
    upwardDecayThreshold: 0.5,
    upwardMinScale: 0.25,
    upwardDecayExponent: 1.5,
    stretchOutwardRetention: 0.55,
    stretchHorizontalRetention: 0.88,
  },
  airChainBonus: {
    speedFlexBonusFactorXZ: 16.0,
    speedFlexBonusFactorY: 1.0,
    maxSpeedFlexBonus: 12.0,
    consecutiveAirBonusDecayRate: 0.5,
  },
  tautSound: {
    soundId: "block.bamboo.hit",
    pitch: 1.5,
    volume: 2.5,
  },
};
