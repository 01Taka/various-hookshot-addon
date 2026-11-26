import { RIGID_WIRE_STYLE } from "../../../render";
import { RIGID_HOOKSHOT_ID, RigidHookshotDefinition } from "./type";

export const RIGID_ITEM_ID = "various_hookshot_addon:rigid_hookshot";

export const rigidHookshotConfig: Omit<
  RigidHookshotDefinition,
  "calculateImpulse"
> = {
  id: RIGID_HOOKSHOT_ID,
  itemTypeId: RIGID_ITEM_ID,
  maxDistance: 200,
  reel: {
    mode: "continuous",
    speed: 2.0,
    soundId: "step.chain",
    soundIntervalTicks: 4,
  },
  reelMode: "shorten",
  minRopeLength: 1.5,
  baumgarteFactor: 0.18,
  reelLengthDiffLimit: {
    outward: 10.0,
  },
  stallReelStop: {
    maxSpeed: 0.1,
    ticks: 4,
    restoreDiff: 4.0,
  },
  raycastGraceTicks: 10,
  shotSoundId: "crossbow.shoot",
  hitSoundId: "place.chain",
  missSoundId: "dig.chain",
  wireStyle: RIGID_WIRE_STYLE,
  enableGazeSteering: true,
  autoTakeUp: {
    ticks: 15,
    speed: 5.0,
  },
  physics: {
    tautMargin: 0.25,
    innerSwingMargin: 2.0,
    innerBaumgarteFactor: 0.08,
    radialCorrectionGain: 0.7,
    inwardEscapeThreshold: 0.45,
    maxSteeringSpeed: 2.2,
    maxSteeringSpeedNormal: 1.7,
    reelGravityScaleVest: 0.8,
    swingPumpAccelNormal: 0.015,
    swingPumpAccelVest: 0.04,
  },
  steering: {
    steerAccel: 0.065,
    steerAccelNormal: 0.05,
    referenceSwingDistance: 30,
    fullSteerAngleDeg: 45,
    steerFadeStartDeg: 90,
    steerFadeEndDeg: 110,
    adPriorityAngleDeg: 30,
    centrifugal3DReferenceAccel: 0.12,
    centrifugal3DDownwardScale: 0.25,
    maxUpwardTiltDeg: 45,
    tiltFullElevationDeg: 30,
    tiltHalfDistance: 30,
    tiltFullDistance: 20,
    tiltRatePerTick: 0.25,
    aboveAnchorDecayTicks: 20,
    belowAnchorRecoveryDelayTicks: 4,
    belowAnchorRecoveryRate: 1,
    centrifugalReferenceAccel: 0.28,
    reelCentrifugalHorizWeight: 1.0,
    reelCentrifugalVertWeight: 0.3,
    centrifugalMinRadius: 8.0,
    minReelSpeedMultiplier: 0.25,
    slackDeadzone: 0.5,
    pumpLowSpeedStart: 0.05,
    pumpLowSpeedEnd: 0.25,
  },
};
