import { Vector3 } from "@minecraft/server";
import {
  AirProbingCapable,
  AirProbingState,
  BaseHookshotDefinition,
  BaseHookshotState,
  ReelCapable,
  RetractCapable,
  RetractState,
  StepReelState,
} from "../../types";

export const BAMBOO_HOOKSHOT_ID = "bamboo";

export interface BambooPhysicsConfig {
  flexibility: number;
  baseStiffnessFactor: number;
  compressionStiffness?: number;
  maxCompression?: number;
  bottomOutBaumgarteFactor: number;
  tangentTransferRatio: number;
  damping: number;
  maxAcceleration: number;
  upwardDecayThreshold: number;
  upwardMinScale: number;
  upwardDecayExponent: number;
  stretchOutwardRetention: number;
  stretchHorizontalRetention: number;
}

export interface BambooPhysicsParams extends BambooPhysicsConfig {
  naturalLength: number;
  surfaceNormal?: Vector3;
}

export interface BambooAirChainState {
  count: number;
  isHooked: boolean;
  hasBeenAirborne: boolean;
}

export interface BambooAirChainBonusConfig {
  speedFlexBonusFactorXZ: number;
  speedFlexBonusFactorY: number;
  maxSpeedFlexBonus: number;
  consecutiveAirBonusDecayRate: number;
}

export interface BambooTautSoundConfig {
  soundId: string;
  pitch: number;
  volume: number;
}

export interface BambooHookshotState
  extends BaseHookshotState<typeof BAMBOO_HOOKSHOT_ID>,
    AirProbingState,
    RetractState,
    StepReelState {}

export interface BambooHookshotDefinition
  extends BaseHookshotDefinition<
      typeof BAMBOO_HOOKSHOT_ID,
      BambooHookshotState
    >,
    ReelCapable,
    AirProbingCapable,
    RetractCapable {
  maxOverstretchDistance: number;
  detachSoundId: string;
  physics: BambooPhysicsConfig;
  airChainBonus: BambooAirChainBonusConfig;
  tautSound: BambooTautSoundConfig;
}
