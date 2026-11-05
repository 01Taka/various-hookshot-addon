import { Vector3Utils } from "@minecraft/math";
import { Player, Vector3 } from "@minecraft/server";
import {
  clampOutwardVelocity,
  convertTargetVelocityToImpulse,
  getAirDrag,
  getDirectionAndDistance,
  getNormalComponent,
  predictTickPhysics,
} from "./physics-utils";

export interface BambooPhysicsParams {
  /** 竹ポールの自然長（現在のロープ長） */
  naturalLength: number;
  /** 着弾面の法線ベクトル（パーティクルと完全同期したしなり方向の計算に使用） */
  surfaceNormal?: Vector3;
  /**
   * しなり具合・柔軟度 (flexibility)
   * 1.0 が標準。値が大きいほど柔らかく深くしなり、値が小さいほど硬くしなりにくくなります。
   * compressionStiffness が未指定の場合、`0.14 / flexibility` として計算されます。
   */
  flexibility?: number;
  /** 圧縮時の弾性バネ定数 (blocks/tick² per block)。縮むほど強力に外側へ押し出す（直接指定時） */
  compressionStiffness?: number;
  /** 最大しなり量（ブロック数）。竹がこれ以上縮まない限界圧縮量（省略時は無制限） */
  maxCompression?: number;
  /**
   * 伸ばす際に接線方向（竹のしなり解消方向）へ振り分けるエネルギー比率 (0.0〜1.0)
   * デフォルト: 0.35 (35%)
   * 外向きに伸びる際（vn > 0）、動径反発力の一部をパーティクルのしなり解消方向へ配分し、跳躍やスイングを加速させます。
   */
  tangentTransferRatio?: number;
  /** 動径方向の速度減衰率 (0〜1)。振動の収束 */
  damping?: number;
  /** 自然長を超えた時の剛体拘束補正係数 (Baumgarte factor) */
  baumgarteFactor?: number;
  /** 1Tickあたりの最大反発加速度 (blocks/tick²) */
  maxAcceleration?: number;
}

/**
 * アンカーとプレイヤー位置、アンカー面法線から、パーティクル描画と完全に同期した竹のしなり方向（接線ベクトル）を計算します。
 */
export function calculateBambooBendDirection(
  playerPos: Vector3,
  anchorPos: Vector3,
  surfaceNormal?: Vector3,
): Vector3 {
  const diff = Vector3Utils.subtract(anchorPos, playerPos);
  const dist = Vector3Utils.magnitude(diff);
  if (dist < 0.0001) return { x: 0, y: 1, z: 0 };

  const dir = Vector3Utils.scale(diff, 1 / dist);
  const globalRef: Vector3 =
    Math.abs(diff.y / dist) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };

  if (surfaceNormal) {
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
  return perpUpLen > 0.05
    ? Vector3Utils.scale(perpUp, 1 / perpUpLen)
    : { x: 0, y: 1, z: 0 };
}

/**
 * 弾性圧縮ロッドモデル（竹ポール）に基づき、目標速度を計算します。
 * - 圧縮時 (r < naturalLength): フックの法則による動径外向き弾性反発力（ダンピング付き）
 *   外側に伸びる瞬間（vn > 0）、しなり反発エネルギーの一部をパーティクルのしなり解消方向へ分配して打ち出します。
 * - 伸長・限界長 (r >= naturalLength): 剛体拘束（竹は伸びないため外向き超過速度をクランプ）
 */
export function calculateBambooVelocity(
  player: Player,
  anchor: Vector3,
  {
    naturalLength,
    surfaceNormal,
    flexibility = 1.0,
    compressionStiffness,
    maxCompression,
    tangentTransferRatio = 0.35,
    damping = 0.02,
    baumgarteFactor = 0.15,
    maxAcceleration = 12,
  }: BambooPhysicsParams,
): Vector3 | null {
  const { dir: normal, distance: r } = getDirectionAndDistance(
    anchor,
    player.location,
  );
  if (r < 0.0001) return null;

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
      const BAUMGARTE_BOTTOM_OUT = 0.2;
      const targetSpeed = bottomOutExcess * BAUMGARTE_BOTTOM_OUT;
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
      compressionStiffness ?? 0.14 / Math.max(0.01, flexibility);

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

    let target = Vector3Utils.add(
      vPred,
      Vector3Utils.scale(normal, totalRadialAccel),
    );

    if (tangentialAccel > 0) {
      const bendDir = calculateBambooBendDirection(
        player.location,
        anchor,
        surfaceNormal,
      );
      target = Vector3Utils.add(
        target,
        Vector3Utils.scale(bendDir, tangentialAccel),
      );
    }

    return target;
  }

  // 3. 伸長・限界長状態 (r >= naturalLength): 竹は伸びない剛体ロッド拘束
  const penetration = stretch;
  const maxOutwardSpeed = -penetration * baumgarteFactor;
  return clampOutwardVelocity(vPred, normal, maxOutwardSpeed);
}

export function calculateBambooHookshot(
  player: Player,
  anchor: Vector3,
  params: BambooPhysicsParams,
): Vector3 {
  const velocity = calculateBambooVelocity(player, anchor, params);
  return convertTargetVelocityToImpulse(player, velocity);
}
