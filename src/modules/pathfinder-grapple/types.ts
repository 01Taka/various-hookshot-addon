import { Vector3 } from "@minecraft/server";

export type PathfinderAnchor = Vector3 & { dimensionId: string };

export type PathfinderDetachReason =
  | "arrival"
  | "angle"
  | "crouch"
  | "jump"
  | "ground"
  | "timeout"
  | "manual";

export interface PathfinderActiveState {
  anchor: PathfinderAnchor;
  attachedTick: number;
  minReachedDistance: number;
  hasGrappleJumped: boolean;
  wasAirborne: boolean;
  startedOnGround: boolean;
  detachReason: PathfinderDetachReason;
}

export interface PathfinderPostFlightState {
  detachedTick: number;
  lastProcessedTick: number;
}
