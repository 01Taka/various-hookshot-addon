import { Vector3Utils } from "@minecraft/math";
import { Player, Vector3 } from "@minecraft/server";
import { BAUMGARTE_BOTTOM_OUT_FACTOR, EPSILON } from "../constants";
import {
  convertTargetVelocityToImpulse,
  getAirDrag,
  getDirectionAndDistance,
  getNormalComponent,
  predictTickPhysics,
} from "../math/physics-utils";
import { BambooPhysicsConfig, BambooPhysicsParams } from "./type";

/**
 * アンカーとプレイヤー位置、アンカー面法線から、パーティクル描画と完全に同期した竹のしなり方向（接線ベクトル）を計算します。
 * - 地面・側面: 上方向基準（globalRef）と竹の直線に直交する凸方向（地面刺しと統一）
 * - 天井面など: 面法線と直線に直交する凸方向
 */
export function calculateBambooBendDirection(
  playerPos: Vector3,
  anchorPos: Vector3,
  surfaceNormal?: Vector3,
): Vector3 {
  const diff = Vector3Utils.subtract(anchorPos, playerPos);
  const dist = Vector3Utils.magnitude(diff);
  if (dist < EPSILON) return { x: 0, y: 1, z: 0 };

  const dir = Vector3Utils.scale(diff, 1 / dist);
  const globalRef: Vector3 =
    Math.abs(diff.y / dist) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };

  if (surfaceNormal && Math.abs(surfaceNormal.y) >= 0.5) {
    const dot = Vector3Utils.dot(surfaceNormal, dir);
    const perp = Vector3Utils.subtract(surfaceNormal, Vector3Utils.scale(dir, dot));
    const perpLen = Vector3Utils.magnitude(perp);
    if (perpLen > 0.05) {
      return Vector3Utils.scale(perp, 1 / perpLen);
    }
  }

  const dotUp = Vector3Utils.dot(globalRef, dir);
  const perpUp = Vector3Utils.subtract(globalRef, Vector3Utils.scale(dir, dotUp));
  const perpUpLen = Vector3Utils.magnitude(perpUp);
  if (perpUpLen <= 0.05) {
    return { x: 0, y: 1, z: 0 };
  }

  let result = Vector3Utils.scale(perpUp, 1 / perpUpLen);
  // 壁・地面では水平より下（y < 0）にしならないよう上向き側へ揃える
  if ((!surfaceNormal || surfaceNormal.y > -0.5) && result.y < 0) {
    result = Vector3Utils.scale(result, -1);
  }
  return result;
}

/**
 * 反発ベクトルの上向き度合い（仰角）に応じた減衰倍率を計算します。
 * 斜め前（閾値以下）は 1.0（無減衰）、真上に近づくにつれて upwardMinScale まで滑らかに減衰します。
 */
export function calculateUpwardDecayFactor(
  reboundAccel: Vector3,
  threshold: number,
  minScale: number,
  exponent: number,
): number {
  if (reboundAccel.y <= 0 || threshold >= 1.0) {
    return 1.0;
  }

  const mag = Vector3Utils.magnitude(reboundAccel);
  if (mag <= EPSILON) {
    return 1.0;
  }

  const clampedThreshold = Math.max(0, Math.min(0.99, threshold));
  const upRatio = reboundAccel.y / mag;
  if (upRatio <= clampedThreshold) {
    return 1.0;
  }

  const t = Math.min(1, (upRatio - clampedThreshold) / (1 - clampedThreshold));
  const clampedMinScale = Math.max(0, Math.min(1, minScale));
  const safeExponent = Math.max(0.1, exponent);
  return 1 - Math.pow(t, safeExponent) * (1 - clampedMinScale);
}

/**
 * 弾性圧縮ロッドモデル（竹ポール）に基づき、目標速度を計算します。
 * - 圧縮時 (r < naturalLength): フックの法則による動径外向き弾性反発力（ダンピング付き）
 *   外側に伸びる瞬間（vn > 0）、しなり反発エネルギーの一部をパーティクルのしなり解消方向へ分配して打ち出します。
 * - 伸長・限界長 (r >= naturalLength): 手動解除を逃した場合の失速ブレーキ（内向き引き戻し・下向き加速は行わない）
 */
export function calculateBambooVelocity(
  player: Player,
  anchor: Vector3,
  {
    naturalLength,
    surfaceNormal,
    flexibility,
    baseStiffnessFactor,
    compressionStiffness,
    maxCompression,
    tangentTransferRatio,
    damping,
    maxAcceleration,
    upwardDecayThreshold,
    upwardMinScale,
    upwardDecayExponent,
    stretchOutwardRetention,
    stretchHorizontalRetention,
  }: BambooPhysicsParams,
): Vector3 | null {
  const { dir: normal, distance: r } = getDirectionAndDistance(
    anchor,
    player.location,
  );
  if (r < EPSILON) return null;

  const currentVel = player.getVelocity();
  const speed = Vector3Utils.magnitude(currentVel);

  // 1. 次Tickの自由予測速度（動的空気抵抗適用）
  let vPred = predictTickPhysics({
    velocity: currentVel,
    dragXZ: getAirDrag(speed),
  });

  const stretch = r - naturalLength;

  // 2. 圧縮状態 (r < naturalLength): フックの法則による動径外向き反発（しなり）
  if (stretch < 0) {
    let compression = -stretch;

    // 最大しなり量（限界圧縮）が指定されている場合の底打ち剛体拘束
    if (maxCompression !== undefined && compression > maxCompression) {
      const bottomOutExcess = compression - maxCompression;
      const targetSpeed = bottomOutExcess * BAUMGARTE_BOTTOM_OUT_FACTOR;
      const vn = getNormalComponent(vPred, normal);

      // normal はアンカーから外向き。vn < targetSpeed なら押し戻す
      if (vn < targetSpeed) {
        vPred = Vector3Utils.add(
          vPred,
          Vector3Utils.scale(normal, targetSpeed - vn),
        );
      }
      compression = maxCompression;
    }

    // しなりやすさ（flexibility）に応じた実効バネ定数の計算
    const effectiveStiffness =
      compressionStiffness ??
      baseStiffnessFactor / Math.max(0.01, flexibility);

    const springAccel = Math.min(
      compression * effectiveStiffness,
      maxAcceleration,
    );
    const vn = getNormalComponent(vPred, normal);
    const dampingAccel = vn * damping;

    // 動径外向き(+normal)の反発加速度（バネ反発 - 動径速度ダンピング）
    let totalRadialAccel = springAccel - dampingAccel;

    // 外向きに伸びる際（vn > 0）に、反発エネルギーの一部を接線方向（竹のしなり解消方向）へ分配
    let tangentialAccel = 0;
    if (vn > 0 && tangentTransferRatio > 0 && totalRadialAccel > 0) {
      const transferRatio = Math.min(Math.max(tangentTransferRatio, 0), 1.0);
      tangentialAccel = totalRadialAccel * transferRatio;
      totalRadialAccel *= 1.0 - transferRatio;
    }

    let reboundAccel = Vector3Utils.scale(normal, totalRadialAccel);

    if (tangentialAccel > 0) {
      const bendDir = calculateBambooBendDirection(
        player.location,
        anchor,
        surfaceNormal,
      );
      reboundAccel = Vector3Utils.add(
        reboundAccel,
        Vector3Utils.scale(bendDir, tangentialAccel),
      );
    }

    const upwardDecayFactor = calculateUpwardDecayFactor(
      reboundAccel,
      upwardDecayThreshold,
      upwardMinScale,
      upwardDecayExponent,
    );
    if (upwardDecayFactor < 1.0) {
      reboundAccel = Vector3Utils.scale(reboundAccel, upwardDecayFactor);
    }

    return Vector3Utils.add(vPred, reboundAccel);
  }

  // 3. 伸長・限界長状態 (r >= naturalLength): 引き戻しのない失速ブレーキ（下向き加速禁止）
  let target = vPred;
  const outwardSpeed = getNormalComponent(target, normal);
  if (outwardSpeed > 0) {
    const clampedOutwardRetention = Math.max(
      0,
      Math.min(1, stretchOutwardRetention),
    );
    const reducedOutward = outwardSpeed * (1 - clampedOutwardRetention);
    target = Vector3Utils.subtract(
      target,
      Vector3Utils.scale(normal, reducedOutward),
    );
  }

  const clampedHorizRetention = Math.max(
    0,
    Math.min(1, stretchHorizontalRetention),
  );
  target = {
    x: target.x * clampedHorizRetention,
    y: target.y,
    z: target.z * clampedHorizRetention,
  };

  // 竹のブレーキによって自由落下より下向きに叩きつけられないよう保護
  const minSafeY = Math.min(0, vPred.y);
  if (target.y < minSafeY) {
    target.y = minSafeY;
  }

  return target;
}

export function calculateBambooHookshot(
  player: Player,
  anchor: Vector3,
  params: BambooPhysicsParams,
): Vector3 {
  const velocity = calculateBambooVelocity(player, anchor, params);
  return convertTargetVelocityToImpulse(player, velocity);
}
