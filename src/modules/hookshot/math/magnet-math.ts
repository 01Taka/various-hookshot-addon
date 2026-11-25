import { Vector3Utils } from "@minecraft/math";
import { Player, Vector3 } from "@minecraft/server";
import { EPSILON, PLAYER_CHEST_HEIGHT_OFFSET } from "../constants";
import { getDirectionAndDistance } from "./physics-utils";

export type MagnetForceMode = "none" | "attract" | "repel";

export interface MagnetPhysicsConfig {
  /** 0m〜fullStrengthDistance における一定の最大加速度 (blocks/tick^2) */
  maxAccel: number;
  /** 最大加速度を維持する距離上限 (blocks, 30m) */
  fullStrengthDistance: number;
  /** 磁場が0になる最大距離 (blocks, 100m) */
  zeroDistance: number;
}

/**
 * 距離 r に応じた磁場の強さ A(r) (blocks/tick^2) を返します。
 * - 0 〜 fullStrengthDistance (30m): maxAccel 一定
 * - fullStrengthDistance 〜 zeroDistance (100m): 1.0 → 0.0 へ滑らかに減衰 (smoothstep)
 * - zeroDistance 以上: 0
 */
export function calculateMagneticFieldStrength(
  distance: number,
  config: MagnetPhysicsConfig,
): number {
  if (distance <= config.fullStrengthDistance) {
    return config.maxAccel;
  }
  if (distance >= config.zeroDistance) {
    return 0;
  }
  const span = Math.max(
    config.zeroDistance - config.fullStrengthDistance,
    EPSILON,
  );
  const t = (distance - config.fullStrengthDistance) / span;
  const smooth = 1 - t * t * (3 - 2 * t);
  return config.maxAccel * smooth;
}

/**
 * 磁場の強さ A(r) に従って、アンカー方向（attract）または逆方向（repel）へ純粋に力を加えます。
 */
export function calculateMagnetHookshot(
  player: Player,
  anchor: Vector3,
  mode: MagnetForceMode,
  config: MagnetPhysicsConfig,
): Vector3 {
  if (mode === "none") {
    return { x: 0, y: 0, z: 0 };
  }

  const chestPos: Vector3 = {
    x: player.location.x,
    y: player.location.y + PLAYER_CHEST_HEIGHT_OFFSET,
    z: player.location.z,
  };

  const { dir, distance } = getDirectionAndDistance(chestPos, anchor);
  if (distance < EPSILON) {
    return { x: 0, y: 0, z: 0 };
  }

  const fieldAccel = calculateMagneticFieldStrength(distance, config);
  if (fieldAccel <= EPSILON) {
    return { x: 0, y: 0, z: 0 };
  }

  const sign = mode === "attract" ? 1 : -1;
  return Vector3Utils.scale(dir, sign * fieldAccel);
}
