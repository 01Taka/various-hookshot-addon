import { Vector3 } from "@minecraft/server";
import { PostFlightState } from "../post-flight";

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

export type PathfinderPostFlightState = PostFlightState;

