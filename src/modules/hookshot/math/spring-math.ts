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

export interface SpringRopeParams {
  /** バネの自然長。これより伸びると引力、縮むと反発力（斥力）が働く */
  naturalLength: number;
  /** バネの限界長。これを超えると硬い拘束に切り替わる */
  maxLength?: number;
  /** バネ定数 (blocks/tick² per block)。大きいほど強く押し引きする */
  stiffness?: number;
  /** 動径方向の減衰率 (0〜1)。大きいほど振動が早く収まる */
  damping?: number;
  /** 1Tickあたりの最大加速度 (blocks/tick²)。急激な伸び縮みでの暴発防止 */
  maxAcceleration?: number;
}

/**
 * 完全な双方向バネ（フックの法則）に基づき、
 * 伸びた時は引力、縮んだ時は斥力（反発力）を受ける目標速度を計算します。
 */
export function calculateSpringVelocity(
  player: Player,
  anchor: Vector3,
  {
    naturalLength,
    maxLength,
    stiffness = 0.03,
    damping = 0.01,
    maxAcceleration = 10,
  }: SpringRopeParams,
): Vector3 | null {
  const { dir: normal, distance: r } = getDirectionAndDistance(
    anchor,
    player.location,
  );
  if (r < 0.0001) return null;

  const currentVel = player.getVelocity();
  const speed = Vector3Utils.magnitude(currentVel);

  const vPred = predictTickPhysics({
    velocity: currentVel,
    dragXZ: getAirDrag(speed),
  });

  // --- 双方向のバネ復元力（フックの法則: F = -k * stretch） ---
  // stretch > 0 (伸びている): 内向き(-normal)に引く力
  // stretch < 0 (縮んでいる): 外向き(+normal)に押し出す力
  const stretch = r - naturalLength;
  const clampedStretchAccel = Math.min(
    stiffness * Math.abs(stretch),
    maxAcceleration,
  );
  const springAccel = Math.sign(stretch) * clampedStretchAccel;

  // 動径方向の速度に比例した減衰（外向き・内向きどちらの運動にもブレーキ）
  const vn = getNormalComponent(vPred, normal);
  const dampingAccel = vn * damping;

  // 合成された動径加速度（正なら内向き加速、負なら外向き反発加速）
  const totalRadialAccel = springAccel + dampingAccel;

  let target = Vector3Utils.subtract(
    vPred,
    Vector3Utils.scale(normal, totalRadialAccel),
  );

  // --- 限界長を超えたら硬い拘束 ---
  if (maxLength) {
    const penetration = Math.max(0, r - maxLength);
    if (penetration > 0) {
      const BAUMGARTE_FACTOR = 0.15;
      target = clampOutwardVelocity(
        target,
        normal,
        -penetration * BAUMGARTE_FACTOR,
      );
    }
  }

  return target;
}

export function calculateSpringHookshot(
  player: Player,
  anchor: Vector3,
  params: SpringRopeParams,
): Vector3 {
  const velocity = calculateSpringVelocity(player, anchor, params);
  return convertTargetVelocityToImpulse(player, velocity);
}
