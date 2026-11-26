import { ELASTIC_WIRE_STYLE } from "../../../render";
import { ELASTIC_HOOKSHOT_ID, ElasticHookshotDefinition } from "./type";

export const ELASTIC_ITEM_ID = "various_hookshot_addon:elastic_hookshot";
export const ELASTIC_AIR_CHAIN_KEY = "elasticAirChainState";

export const elasticHookshotConfig: Omit<
  ElasticHookshotDefinition,
  "calculateImpulse"
> = {
  id: ELASTIC_HOOKSHOT_ID,
  itemTypeId: ELASTIC_ITEM_ID,
  maxDistance: 250,
  reel: {
    mode: "continuous",
    speed: 1.8,
    slackSpeed: 4.5,
    initialDelta: 0.0,
    soundId: "step.cloth",
    soundIntervalTicks: 4,
  },
  reelMode: "shorten",
  minRopeLength: 1.5,
  baumgarteFactor: 0.15,
  maxOverstretchDistance: 105.0,
  overstretchSoundId: "various_hookshot_addon.elastic_break",
  distanceReelSpeed: {
    minDistance: 20.0,
    maxDistance: 120.0,
    maxSpeed: 4.0,
  },
  chargeSpeedBoost: {
    airChainMinSpeed: 4.5,
    airChainMaxSpeed: 5.2,
  },
  raycastGraceTicks: 10,
  shotSoundId: "armor.equip_leather",
  hitSoundId: "leashknot.place",
  missSoundId: "leashknot.break",
  physics: {
    minConstraintLength: 250,
    constraintLengthMultiplier: 1.5,
    hangElasticity: 0.65,
    minHangDenominator: 18.0,
    maxHangDenominator: 120.0,
    chargeStiffness: 0.003,
    damping: 0.001,
    chargeDamping: 0.085,
    maxAcceleration: 1.35,
    inputChargeControl: {
      enabled: true,
      forwardGainNormal: 0.5,
      forwardGainBoosted: 1.2,
      backwardMinMultiplierNormal: 0.65,
      backwardMinMultiplierBoosted: 0.3,
    },
  },
  release: {
    soundId: "random.bow",
    minStretch: 5.0,
    referenceStretch: 90.0,
    minLaunchSpeed: 1.45,
    maxLaunchSpeed: 4.0,
    launchSpeedExponent: 1.6,
    boostedStretchMultiplier: 1.3,
    upwardBias: 0.22,
    minFlightTicks: 4,
    stallApproachSpeed: 0.4,
    maxStallTicks: 5,
    maxReleaseTicks: 60,
  },
  chargeMilestoneSound: {
    soundId: "note.guitar",
    step: 15,
    maxStretch: 90,
    hysteresis: 5,
    pitches: [0.65, 0.85, 1.1, 1.35, 1.65, 1.95],
  },
  wireStyle: ELASTIC_WIRE_STYLE,
};
