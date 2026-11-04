import { Vector3Utils } from "@minecraft/math";
import { Player, Vector3 } from "@minecraft/server";
import {
  calculateVelocityImpulse,
  MINECRAFT_DRAG,
  MINECRAFT_GRAVITY,
} from "addon-utils";

/**
 * 2点間の方向（正規化ベクトル）と距離を同時に取得します。
 */
export function getDirectionAndDistance(
  from: Vector3,
  to: Vector3,
): { dir: Vector3; distance: number } {
  const diff = Vector3Utils.subtract(to, from);
  const distance = Vector3Utils.magnitude(diff);

  if (distance < 0.0001) {
    return { dir: { x: 0, y: 0, z: 0 }, distance: 0 };
  }

  return {
    dir: Vector3Utils.scale(diff, 1 / distance),
    distance,
  };
}

export interface PredictTickPhysicsParams {
  velocity: Vector3;
  gravity?: number;
  dragY?: number;
  dragXZ?: number;
}

/**
 * Minecraft の標準重力と空気抵抗を適用し、次Tickの自由移動速度を予測します。
 */
export function predictTickPhysics({
  velocity,
  gravity = MINECRAFT_GRAVITY,
  dragY = MINECRAFT_DRAG.air.y,
  dragXZ = MINECRAFT_DRAG.air.xz,
}: PredictTickPhysicsParams): Vector3 {
  return {
    x: velocity.x * dragXZ,
    y: (velocity.y - gravity) * dragY,
    z: velocity.z * dragXZ,
  };
}

/**
 * ベクトル v の特定方向（単位法線ベクトル）成分の大きさ（内積）を取得します。
 */
export function getNormalComponent(v: Vector3, normal: Vector3): number {
  return Vector3Utils.dot(v, normal);
}

/**
 * 法線方向の速度が許容値（maxOutwardSpeed）を超えている場合、
 * その超過分のみを削り取ったベクトルを返します。（自己加速を防ぐ射影拘束）
 */
export function clampOutwardVelocity(
  velocity: Vector3,
  normal: Vector3,
  maxOutwardSpeed: number = 0,
): Vector3 {
  const vn = Vector3Utils.dot(velocity, normal);
  const excess = vn - maxOutwardSpeed;

  if (excess > 0) {
    return Vector3Utils.subtract(velocity, Vector3Utils.scale(normal, excess));
  }
  return velocity;
}

/**
 * 超過速度に応じた動的空気抵抗（過剰加速防止）
 */
export function getAirDrag(speed: number): number {
  const SPEED_THRESHOLD = 1.6; // blocks/tick
  const DRAG_COEFFICIENT = 0.4;

  let effectiveDragXZ = 0.99;

  if (speed > SPEED_THRESHOLD) {
    const excessSpeed = speed - SPEED_THRESHOLD;
    const brakeFactor = 1 / (1 + DRAG_COEFFICIENT * excessSpeed * excessSpeed);
    effectiveDragXZ *= brakeFactor;
  }

  return effectiveDragXZ;
}

/**
 * 目標速度ベクトルを、Minecraftの標準環境（空中）で次Tickに到達するためのインパルスに変換します。
 * 目標速度が null（外力不要・自由運動）の場合はゼロベクトルを返します。
 */
export function convertTargetVelocityToImpulse(
  player: Player,
  targetVelocity: Vector3 | null,
): Vector3 {
  if (targetVelocity === null) {
    return { x: 0, y: 0, z: 0 };
  }

  return calculateVelocityImpulse({
    targetVelocity,
    currentVelocity: player.getVelocity(),
    dragXZ: MINECRAFT_DRAG.air.xz,
    dragY: MINECRAFT_DRAG.air.y,
    gravity: MINECRAFT_GRAVITY,
  });
}
