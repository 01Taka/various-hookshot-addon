import { Vector3 } from "@minecraft/server";
import { RigidSteeringConfig } from "../../math/steering-math";
import { BaseHookshotDefinition, BaseHookshotState } from "../../types";
import { RigidPhysicsConfig } from "../rigid/type";

export const ZIPLINE_HOOKSHOT_ID = "zipline";

export interface ZiplineRailPhysicsConfig {
  inputAccel: number;
  railGravity: number;
  friction: number;
  brakeFriction: number;
  maxRailSpeed: number;
  maxAnchorDistance: number;
  tautChainLength: number;
  torsoHeightOffset: number;
  stopSpeedThreshold: number;
}

export interface ZiplineRailStepInput {
  railStart: Vector3;
  railEnd: Vector3;
  railLength: number;
  railProgress: number;
  railVelocity: number;
  dimensionId: string;
  jumpPressed: boolean;
  sneakPressed: boolean;
  inputDirectionSign: 1 | -1;
  isOnGround: boolean;
  playerLocation: Vector3;
  config: ZiplineRailPhysicsConfig;
}

export interface ZiplineRailStepResult {
  railProgress: number;
  railVelocity: number;
  anchor: Vector3 & { dimensionId: string };
}

export interface ZiplineHookshotOptions {
  baumgarteFactor: number;
  physics: RigidPhysicsConfig;
  steering: RigidSteeringConfig;
  swingPumpAccel: number;
  railDir: Vector3;
  anchorVelocity: Vector3;
  parallelDamping?: number;
  lateralDamping?: number;
  suppressParallelSwing?: boolean;
}

export interface ZiplineHookshotState
  extends BaseHookshotState<typeof ZIPLINE_HOOKSHOT_ID> {
  railBase: Vector3;
  endRailBase?: Vector3;
  endRailTop?: Vector3;
  railStart: Vector3;
  railEnd: Vector3;
  startSupportBlock: Vector3;
  endSupportBlock: Vector3;
  railLength: number;
  railProgress: number;
  railVelocity: number;
  facingDirectionSign?: 1 | -1;
  lastSlideSoundTick?: number;
  gentleDescentTicks?: number;
  lastSlowFallTick?: number;
}

export interface ZiplineHookshotDefinition
  extends BaseHookshotDefinition<
    typeof ZIPLINE_HOOKSHOT_ID,
    ZiplineHookshotState
  > {
  groundCheck: {
    halfWidth: number;
    maxDownDistance: number;
    pillarHeight: number;
    ceilingClearance: number;
    endNormalOffset: number;
    minRailLength: number;
  };
  hangingRopeLength: number;
  idleSlackOffset: number;
  activePullOffset: number;
  visualChainLength: number;
  hitSoundId: string;
  missSoundId: string;
  detachSoundId: string;
  slideSound: {
    soundId: string;
    intervalTicks: number;
    minSpeed: number;
  };
  fallProtection: {
    minAnchorVelY: number;
    minPlayerVelY: number;
    requiredConsecutiveTicks: number;
    cooldownTicks: number;
  };
  railPhysics: ZiplineRailPhysicsConfig;
  physics: RigidPhysicsConfig;
  steering: RigidSteeringConfig;
}
