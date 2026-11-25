import { Vector3Utils } from "@minecraft/math";
import { Player, Vector3 } from "@minecraft/server";
import {
  calculateVelocityImpulse,
  MINECRAFT_DRAG,
  MINECRAFT_GRAVITY,
} from "addon-utils";
import { EPSILON, PLAYER_CHEST_HEIGHT_OFFSET } from "../constants";
import { getDirectionAndDistance, predictTickPhysics } from "./physics-utils";

export type MagnetForceMode = "none" | "attract" | "repel";

export interface MagnetPhysicsConfig {
  /** 0m〜fullStrengthDistance における一定の最大加速度 (blocks/tick^2) */
  maxAccel: number;
  /** 最大加速度を維持する距離上限 (blocks, 30m) */
  fullStrengthDistance: number;
  /** 磁場が0になる最大距離 (blocks, 100m) */
  zeroDistance: number;
  /** 初回起動ブースト時の加速度倍率 */
  initialBoostMultiplier: number;
  /** 地上から初回ブースト発動時に付与する最小上向きリフト (blocks/tick) */
  initialBoostGroundLiftY: number;
  /** 引き寄せ時の磁気吸着ロック半径 (blocks, 1.5〜2.0m) */
  attractLockRadius: number;
  /** 引き寄せ時の最大移動速度 (blocks/tick) */
  maxSpeed: number;
  /** 反発時の接線方向（横滑り）速度保持率 */
  repelTangentRetention: number;
  /** 反発時の動径（法線）方向ダンピング（バネ跳ね防止） */
  repelRadialDamping: number;
  /** 初回起動までの連続入力必要Tick数 (5〜6 ticks = 0.25〜0.3秒) */
  startupDelayTicks: number;
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
  const span = Math.max(config.zeroDistance - config.fullStrengthDistance, EPSILON);
  const t = (distance - config.fullStrengthDistance) / span;
  const smooth = 1 - t * t * (3 - 2 * t);
  return config.maxAccel * smooth;
}

/**
 * 磁場の強さ A(r) に基づき、引き寄せ（磁気吸着ロック）または反発（磁気浮上＋無摩擦横滑り）のインパルスを計算します。
 */
export function calculateMagnetHookshot(
  player: Player,
  anchor: Vector3,
  mode: MagnetForceMode,
  isBoostTick: boolean,
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
  const fieldAccel = calculateMagneticFieldStrength(distance, config);
  const boostScale = isBoostTick ? config.initialBoostMultiplier : 1.0;

  const currentVel = player.getVelocity();
  const dragY = player.isOnGround
    ? MINECRAFT_DRAG.ground.y
    : MINECRAFT_DRAG.air.y;
  const dragXZ = player.isOnGround
    ? MINECRAFT_DRAG.ground.xz
    : MINECRAFT_DRAG.air.xz;
  const predictedVel = predictTickPhysics({
    velocity: currentVel,
    dragY,
    dragXZ,
  });

  let targetVel: Vector3;

  if (mode === "attract") {
    // 引き寄せ（Shift）: 吸い込み → 磁気吸着ロック
    if (distance <= config.attractLockRadius) {
      // 至近距離では強い減衰をかけて通り過ぎずに壁・天井へピタッと吸着・静止
      const pullSpeed = distance > 0.35 ? Math.min(distance * 0.18, 0.22) : 0;
      const desiredLockVel = Vector3Utils.scale(dir, pullSpeed);
      targetVel = Vector3Utils.add(
        Vector3Utils.scale(currentVel, 0.2),
        Vector3Utils.scale(desiredLockVel, 0.8),
      );
    } else {
      if (fieldAccel <= EPSILON && !isBoostTick) {
        return { x: 0, y: 0, z: 0 };
      }
      const accel = fieldAccel * boostScale;
      targetVel = Vector3Utils.add(predictedVel, Vector3Utils.scale(dir, accel));

      // ロック半径手前での高速突入時は減衰してオーバーシュートを防止
      if (distance < config.attractLockRadius + 2.5 && !isBoostTick) {
        const inwardSpeed = Vector3Utils.dot(targetVel, dir);
        const maxApproachSpeed = Math.max(0.25, (distance - config.attractLockRadius) * 0.35 + 0.25);
        if (inwardSpeed > maxApproachSpeed) {
          targetVel = Vector3Utils.subtract(
            targetVel,
            Vector3Utils.scale(dir, inwardSpeed - maxApproachSpeed),
          );
        }
      }
    }
  } else {
    // 反発（Jump）: 弾き出し ＋ 磁気浮上 ＋ 無摩擦横滑り
    if (fieldAccel <= EPSILON && !isBoostTick) {
      return { x: 0, y: 0, z: 0 };
    }
    const outDir =
      distance >= EPSILON ? Vector3Utils.scale(dir, -1) : { x: 0, y: 1, z: 0 };

    const curRadial = Vector3Utils.dot(currentVel, outDir);
    const curTangent = Vector3Utils.subtract(
      currentVel,
      Vector3Utils.scale(outDir, curRadial),
    );

    const predRadial = Vector3Utils.dot(predictedVel, outDir);
    const radialDamping = isBoostTick ? 1.0 : config.repelRadialDamping;
    const nextRadial = predRadial * radialDamping + fieldAccel * boostScale;

    // 接線方向の抵抗を抑えて滑らかな横滑りを実現
    const nextTangent = Vector3Utils.scale(curTangent, config.repelTangentRetention);

    targetVel = Vector3Utils.add(
      nextTangent,
      Vector3Utils.scale(outDir, nextRadial),
    );
  }

  // 地上で初回ブースト発動時は地面摩擦に負けないよう最小上向きリフトを保証
  if (
    isBoostTick &&
    player.isOnGround &&
    targetVel.y < config.initialBoostGroundLiftY
  ) {
    targetVel = {
      ...targetVel,
      y: config.initialBoostGroundLiftY,
    };
  }

  const speed = Vector3Utils.magnitude(targetVel);
  if (speed > config.maxSpeed && speed > EPSILON) {
    targetVel = Vector3Utils.scale(targetVel, config.maxSpeed / speed);
  }

  return calculateVelocityImpulse({
    targetVelocity: targetVel,
    currentVelocity: currentVel,
    dragXZ,
    dragY,
    gravity: MINECRAFT_GRAVITY,
  });
}
