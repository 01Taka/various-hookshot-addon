import { Vector3Utils } from "@minecraft/math";
import { Player, Vector3 } from "@minecraft/server";
import {
  MINECRAFT_GRAVITY,
  MINECRAFT_DRAG,
  calculateVelocityImpulse,
} from "addon-utils";

/**
 * 2点間の方向（正規化ベクトル）と距離を同時に取得します。
 * （Math.hypot の二重計算を防ぐ最適化）
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

// =================================================================
// 4. メイン拘束計算関数（固定長ロープ）
// =================================================================

export function getAirDrag(speed: number) {
  // 1. 閾値（これ以上の速度から急激にブレーキをかける）
  const SPEED_THRESHOLD = 1.6; // blocks/tick

  // 2. 超過分に対する3乗抵抗の強さ
  const DRAG_COEFFICIENT = 0.4;

  let effectiveDragXZ = 0.99;

  if (speed > 1.6) {
    // 超過したスピード（Δv）
    const excessSpeed = speed - SPEED_THRESHOLD;

    // 超過分の2乗に比例して分母を爆発させる（全体として3乗のブレーキ）
    // 1 / (1 + k * excessSpeed^2)
    const brakeFactor = 1 / (1 + DRAG_COEFFICIENT * excessSpeed * excessSpeed);

    effectiveDragXZ *= brakeFactor;
  }

  return effectiveDragXZ;
}

/**
 * 速度射影 + Baumgarte安定化（位置補正）に基づき、
 * ロープ拘束を満たす目標速度を計算します。
 *
 * @param player 対象プレイヤー
 * @param anchor アンカーブロックの中心座標
 * @param maxDistance ロープの最大長
 * @returns 拘束適用後の速度ベクトル。外力が不要（たるみ中）な場合は null
 */
function calculateNextVelocity(
  player: Player,
  anchor: Vector3,
  maxDistance: number,
): Vector3 | null {
  // 1. アンカーからプレイヤーへの方向（外向き法線）と現在の距離を計算
  const { dir: normal, distance: r } = getDirectionAndDistance(
    anchor,
    player.location,
  );
  if (r < 0.0001) return null;

  const currentVel = player.getVelocity();
  const speed = Vector3Utils.magnitude(currentVel);

  // 予測速度の計算に動的な空気抵抗を渡す
  const vPred = predictTickPhysics({
    velocity: currentVel,
    dragXZ: getAirDrag(speed),
  });

  // 3. 外向き法線方向の速度成分と、1Tick後の予測距離
  const vn = getNormalComponent(vPred, normal);
  const predDistance = r + vn;

  // 4. はみ出し距離（浸透量）に応じた内向き引き戻し速度の計算
  // ※ 15%（0.15）の強さで内側へ引き戻す
  const BAUMGARTE_FACTOR = 0.15;
  const penetration = Math.max(0, r - maxDistance);
  const pullBackSpeed = penetration * BAUMGARTE_FACTOR;

  // 5. たるみ判定
  // 現在はみ出ておらず、1Tick後も最大長以内で、かつ内側に向かっている場合は自由落下
  if (penetration === 0 && predDistance <= maxDistance && vn <= 0) {
    return null;
  }

  // 6. 速度拘束の適用
  // 許容される動径速度の上限を「-pullBackSpeed（内向き）」に設定することで、
  // 外向き成分をカットしつつ、はみ出した分だけ正確に内側へ引き戻す速度を上乗せする
  return clampOutwardVelocity(vPred, normal, -pullBackSpeed);
}

export function calculateRetractableHookshot(
  player: Player,
  anchor: Vector3,
  currentRopeLength: number,
): Vector3 {
  const velocity = calculateNextVelocity(player, anchor, currentRopeLength);
  if (velocity === null)
    return {
      x: 0,
      y: 0,
      z: 0,
    };

  const impulse = calculateVelocityImpulse({
    targetVelocity: velocity,
    currentVelocity: player.getVelocity(),
    dragXZ: MINECRAFT_DRAG.air.xz,
    dragY: MINECRAFT_DRAG.air.y,
    gravity: MINECRAFT_GRAVITY,
  });

  return impulse;
}
