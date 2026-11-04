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

/**
 * 速度射影 + Baumgarte安定化（位置補正）に基づき、
 * 伸びのない剛体ロープ拘束を満たす目標速度を計算します。
 */
export function calculateRigidVelocity(
  player: Player,
  anchor: Vector3,
  ropeLength: number,
): Vector3 | null {
  const { dir: normal, distance: r } = getDirectionAndDistance(
    anchor,
    player.location,
  );
  if (r < 0.0001) return null;

  const currentVel = player.getVelocity();
  const speed = Vector3Utils.magnitude(currentVel);

  // 1. アドオンがシミュレートしたい環境抵抗（空気抵抗0.99）を適用した予測速度
  const vPred = predictTickPhysics({
    velocity: currentVel,
    dragXZ: getAirDrag(speed),
  });

  const originalSpeed = Vector3Utils.magnitude(vPred);
  const vn = getNormalComponent(vPred, normal);
  const predDistance = r + vn;

  // 2. たるみ判定：次Tickの予測距離がロープ長以内であれば、外力不要（完全な自由落下）
  if (predDistance <= ropeLength) {
    return null;
  }

  // 3. 拘束適用：ロープ長を超える外向き成分をクランプ
  const penetration = Math.max(0, r - ropeLength);
  const BAUMGARTE_FACTOR = 0.15;

  // まだはみ出ていない場合はちょうどロープ長に留まる速度 (ropeLength - r) を上限とし、
  // すでにはみ出ている場合のみマイルドに内側へ引き戻す (-penetration * 0.15)
  const maxOutwardSpeed =
    penetration > 0
      ? -penetration * BAUMGARTE_FACTOR
      : Math.max(0, ropeLength - r);

  const candidateVelocity = clampOutwardVelocity(vPred, normal, maxOutwardSpeed);

  // 4. 自己加速の防止（エネルギー保存制約）：
  // 引き戻し補正によって元の予測速さを超えてしまった場合、向きを維持したまま元の速さにクランプ
  const candidateSpeed = Vector3Utils.magnitude(candidateVelocity);
  if (candidateSpeed > originalSpeed && candidateSpeed > 0.0001) {
    return Vector3Utils.scale(
      candidateVelocity,
      originalSpeed / candidateSpeed,
    );
  }

  return candidateVelocity;
}

export function calculateRigidHookshot(
  player: Player,
  anchor: Vector3,
  ropeLength: number,
): Vector3 {
  const velocity = calculateRigidVelocity(player, anchor, ropeLength);
  return convertTargetVelocityToImpulse(player, velocity);
}
