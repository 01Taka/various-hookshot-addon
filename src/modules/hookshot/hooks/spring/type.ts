import { Vector3 } from "@minecraft/server";
import {
  AirProbingCapable,
  AirProbingState,
  BaseHookshotDefinition,
  BaseHookshotState,
  ContinuousReelState,
  ReelCapable,
  RetractCapable,
  RetractState,
} from "../../types";

export const SPRING_HOOKSHOT_ID = "spring";

export interface SpringPhysicsConfig {
  minConstraintLength: number;
  constraintLengthMultiplier: number;
  stiffness: number;
  damping: number;
  maxAcceleration: number;
  minRadialDenominator: number;
  minBendingDenominator: number;
  bendingStiffness: number;
  bendingPower: number;
  bendingDamping: number;
  bendingReturnDampingMultiplier?: number;
  horizontalBendingMaxAccel?: number;
  surfacePenetrationMultiplier: number;
}

export interface SpringRopeParams
  extends Omit<
    SpringPhysicsConfig,
    "minConstraintLength" | "constraintLengthMultiplier"
  > {
  naturalLength: number;
  maxLength?: number;
  baumgarteFactor: number;
  surfaceNormal?: Vector3;
  bendingAxis?: Vector3;
}

export interface SpringHookshotState
  extends BaseHookshotState<typeof SPRING_HOOKSHOT_ID>,
    AirProbingState,
    RetractState,
    ContinuousReelState {
  initialDirection?: Vector3;
  isAutoExtendingToMin?: boolean;
  lastExtendDistance?: number;
  lastShortenTick?: number;
  shortenDampingBlend?: number;
}

export interface SpringAutoExtendToMinConfig {
  speed: number;
}

export interface SpringShortenCompressionBrakeConfig {
  brakePerBlock: number;
  minSpeedMultiplier: number;
}

export interface SpringShortenBendingDampingConfig {
  boostedDamping: number;
  rampUpTicks: number;
  rampDownTicks: number;
}

export type SpringBendingMode = "shot_angle" | "surface_normal";

export interface SpringHookshotDefinition
  extends BaseHookshotDefinition<
      typeof SPRING_HOOKSHOT_ID,
      SpringHookshotState
    >,
    ReelCapable,
    AirProbingCapable,
    RetractCapable {
  matchOutwardExtend: boolean;
  autoExtendToMin: SpringAutoExtendToMinConfig;
  shortenCompressionBrake: SpringShortenCompressionBrakeConfig;
  shortenBendingDamping: SpringShortenBendingDampingConfig;
  bendingMode: SpringBendingMode;
  physics: SpringPhysicsConfig;
  getWireAxis: (state: SpringHookshotState) => Vector3 | undefined;
}
