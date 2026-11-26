import { Player, Vector3 } from "@minecraft/server";
import { BaseHookshotDefinition, BaseHookshotState } from "../../types";

export const MAGNET_HOOKSHOT_ID = "magnet";

export type MagnetForceMode = "none" | "attract" | "repel";

export interface MagnetPhysicsConfig {
  fullEffectDistance: number;
  zeroEffectDistance: number;
  attractInitialSpeed: number;
  attractAccel: number;
  attractMaxSpeed: number;
  attractNearRadius: number;
  attractNearScale: number;
  attractStickRadius: number;
  attractGravityCancelStart: number;
  attractGravityCancelRampTicks: number;
  repelBurstSpeed: number;
  repelSustainAccel: number;
  repelRefDistance: number;
  repelBurstCooldownTicks: number;
  repelSustainDelayTicks: number;
  repelSlowFallMinImpulseY: number;
}

export interface MagnetContactAxis {
  dir: Vector3;
  surfaceDist: number;
}

export interface MagnetHookshotState
  extends BaseHookshotState<typeof MAGNET_HOOKSHOT_ID> {
  blockPos: Vector3;
  activeMode: MagnetForceMode;
  isModeEntryTick?: boolean;
  canAutoDetachOnGround?: boolean;
  isStuck?: boolean;
  stuckLocation?: Vector3;
  lastActiveSoundTick?: number;
  lastRepelBurstTick?: number;
  attractHoldTicks?: number;
  repelHoldTicks?: number;
}

export interface MagnetHookshotDefinition
  extends BaseHookshotDefinition<
    typeof MAGNET_HOOKSHOT_ID,
    MagnetHookshotState
  > {
  hitSoundId: string;
  missSoundId: string;
  detachSoundId: string;
  activeSound: {
    soundId: string;
    intervalTicks: number;
  };
  physics: MagnetPhysicsConfig;
}

export type MagnetSoundPlayer = (
  player: Player,
  soundId: string,
  pitch?: number,
) => void;
