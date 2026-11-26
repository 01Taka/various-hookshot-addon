import { Vector3 } from "@minecraft/server";
import { RigidSteeringConfig } from "../../math/steering-math";
import {
  BaseHookshotDefinition,
  BaseHookshotState,
  ContinuousReelState,
  GazeSteeringCapable,
  RaycastGraceCapable,
  ReelCapable,
} from "../../types";

export const RIGID_HOOKSHOT_ID = "rigid";

export interface RigidPhysicsConfig {
  tautMargin: number;
  innerSwingMargin: number;
  innerBaumgarteFactor: number;
  radialCorrectionGain: number;
  inwardEscapeThreshold: number;
  maxSteeringSpeed: number;
  maxSteeringSpeedNormal?: number;
  reelGravityScaleVest?: number;
  swingPumpAccelNormal: number;
  swingPumpAccelVest: number;
}

export interface RigidHookshotOptions {
  isReelingIn?: boolean;
  enableSteering?: boolean;
  hasAeroVest?: boolean;
  aboveAnchorTicks?: number;
  baumgarteFactor: number;
  physics: RigidPhysicsConfig;
  steering: RigidSteeringConfig;
  swingPumpAccel: number;
  suppressPumpParallelDir?: Vector3;
}

export interface RigidHookshotState
  extends BaseHookshotState<typeof RIGID_HOOKSHOT_ID>,
    ContinuousReelState {
  autoTakeUpRemainingTicks?: number;
  stallReelTicks?: number;
  aboveAnchorTicks?: number;
  belowAnchorTicks?: number;
}

export interface RigidHookshotDefinition
  extends BaseHookshotDefinition<typeof RIGID_HOOKSHOT_ID, RigidHookshotState>,
    ReelCapable,
    RaycastGraceCapable,
    GazeSteeringCapable {
  autoTakeUp: {
    ticks: number;
    speed: number;
  };
  stallReelStop: {
    maxSpeed: number;
    ticks: number;
    restoreDiff: number;
  };
  physics: RigidPhysicsConfig;
  steering: RigidSteeringConfig;
}
