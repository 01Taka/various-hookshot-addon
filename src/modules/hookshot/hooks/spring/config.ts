import { SPRING_WIRE_STYLE } from "../../../render";
import { SPRING_HOOKSHOT_ID, SpringHookshotDefinition } from "./type";

export const SPRING_ITEM_ID = "various_hookshot_addon:spring_hookshot";

export const springHookshotConfig: Omit<
  SpringHookshotDefinition,
  "calculateImpulse" | "getWireAxis"
> = {
  id: SPRING_HOOKSHOT_ID,
  itemTypeId: SPRING_ITEM_ID,
  maxDistance: 48,
  reel: {
    mode: "continuous",
    speed: {
      shorten: 1.0,
      extend: 0.5,
    },
    initialDelta: 0.0,
  },
  reelMode: "extend",
  minRopeLength: 5.0,
  baumgarteFactor: 0.15,
  matchOutwardExtend: true,
  autoExtendToMin: {
    speed: 2.0,
  },
  shortenCompressionBrake: {
    brakePerBlock: 0.2,
    minSpeedMultiplier: 0.25,
  },
  shortenBendingDamping: {
    boostedDamping: 0.25,
    rampUpTicks: 8,
    rampDownTicks: 16,
  },
  bendingMode: "shot_angle",
  physics: {
    minConstraintLength: 200,
    constraintLengthMultiplier: 1.5,
    stiffness: 0.9,
    damping: 0.01,
    maxAcceleration: 10,
    minRadialDenominator: 7.0,
    minBendingDenominator: 3.0,
    bendingStiffness: 1.8,
    bendingPower: 2,
    bendingDamping: 0.02,
    bendingReturnDampingMultiplier: 4.0,
    horizontalBendingMaxAccel: 0.24,
    surfacePenetrationMultiplier: 1.5,
  },
  shotSoundId: "mob.slime.jump",
  airProbing: {
    initialLength: 2.0,
    extend: {
      mode: "continuous",
      speed: 4.0,
      soundId: "step.slime",
      soundIntervalTicks: 2,
    },
    minHitDistance: 0.5,
    hitSoundId: "place.slime.big",
  },
  retract: {
    mode: "continuous",
    speed: 4.0,
    soundId: "step.slime",
    soundIntervalTicks: 2,
  },
  wireStyle: SPRING_WIRE_STYLE,
};
