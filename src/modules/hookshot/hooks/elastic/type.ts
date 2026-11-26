import {
  BaseHookshotDefinition,
  BaseHookshotState,
  ChargeMilestoneSoundConfig,
  ContinuousReelState,
  RaycastGraceCapable,
  ReelCapable,
} from "../../types";

export const ELASTIC_HOOKSHOT_ID = "elastic";

export interface ElasticInputChargeControlConfig {
  enabled: boolean;
  forwardGainNormal: number;
  forwardGainBoosted: number;
  backwardMinMultiplierNormal: number;
  backwardMinMultiplierBoosted: number;
}

export interface ElasticPhysicsConfig {
  minConstraintLength: number;
  constraintLengthMultiplier: number;
  stiffness?: number;
  hangElasticity: number;
  minHangDenominator: number;
  maxHangDenominator: number;
  chargeStiffness: number;
  releaseStiffness?: number;
  damping: number;
  chargeDamping: number;
  maxAcceleration: number;
  inputChargeControl: ElasticInputChargeControlConfig;
}

export interface ElasticReleaseConfig {
  soundId: string;
  minStretch: number;
  referenceStretch: number;
  minLaunchSpeed: number;
  maxLaunchSpeed: number;
  launchSpeedExponent: number;
  boostedStretchMultiplier?: number;
  upwardBias: number;
  minFlightTicks: number;
  stallApproachSpeed: number;
  maxStallTicks: number;
  maxReleaseTicks: number;
}

export interface ElasticRopeParams
  extends Omit<
    ElasticPhysicsConfig,
    "minConstraintLength" | "constraintLengthMultiplier" | "inputChargeControl"
  > {
  naturalLength: number;
  extraCharge?: number;
  maxLength?: number;
  baumgarteFactor: number;
  isReelingIn?: boolean;
  isChargeReleasing?: boolean;
  releaseShotPending?: boolean;
  inputChargeControl: ElasticInputChargeControlConfig;
  boostInputChargeControl?: boolean;
  release: ElasticReleaseConfig;
}

export interface ElasticAirChainState {
  hasBeenAirborne: boolean;
  launchTick: number;
}

export interface ElasticHookshotState
  extends BaseHookshotState<typeof ELASTIC_HOOKSHOT_ID>,
    ContinuousReelState {
  extraCharge?: number;
  isChargeReleasing?: boolean;
  releaseShotPending?: boolean;
  releaseStartTick?: number;
  lastReleaseDistance?: number;
  releaseStallTicks?: number;
  prevChargeStretch?: number;
  lastChargeSoundThreshold?: number;
  canRetriggerLastThreshold?: boolean;
}

export interface ElasticDistanceReelSpeedConfig {
  minDistance: number;
  maxDistance: number;
  maxSpeed: number;
}

export interface ElasticChargeSpeedBoostConfig {
  airChainMinSpeed: number;
  airChainMaxSpeed: number;
}

export interface ElasticHookshotDefinition
  extends BaseHookshotDefinition<
      typeof ELASTIC_HOOKSHOT_ID,
      ElasticHookshotState
    >,
    ReelCapable,
    RaycastGraceCapable {
  maxExtraCharge?: number;
  maxOverstretchDistance: number;
  overstretchSoundId: string;
  distanceReelSpeed: ElasticDistanceReelSpeedConfig;
  chargeSpeedBoost: ElasticChargeSpeedBoostConfig;
  physics: ElasticPhysicsConfig;
  release: ElasticReleaseConfig;
  chargeMilestoneSound: ChargeMilestoneSoundConfig;
}
