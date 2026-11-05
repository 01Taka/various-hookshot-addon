import { Player, Vector3 } from "@minecraft/server";
import {
  BambooPhysicsParams,
  calculateBambooHookshot,
  calculateBambooVelocity,
} from "./bamboo-math";

export * from "./bamboo-math";

/**
 * @deprecated BambooPhysicsParams を使用してください。
 */
export type BambooVaultParams = BambooPhysicsParams & {
  liftFactor?: number;
  surfaceNormal?: Vector3;
};

/**
 * @deprecated calculateBambooVelocity を使用してください。
 */
export function calculateBambooVaultVelocity(
  player: Player,
  anchor: Vector3,
  params: BambooVaultParams,
): Vector3 | null {
  return calculateBambooVelocity(player, anchor, params);
}

/**
 * @deprecated calculateBambooHookshot を使用してください。
 */
export function calculateBambooVaultHookshot(
  player: Player,
  anchor: Vector3,
  params: BambooVaultParams,
): Vector3 {
  return calculateBambooHookshot(player, anchor, params);
}
