import { Vector3Utils } from "@minecraft/math";
import { Player, Vector3 } from "@minecraft/server";
import {
  MINECRAFT_DRAG,
  MINECRAFT_GRAVITY,
  PlayerStateManager,
} from "addon-utils";

// スカラー値（最高速度）を保持するキー
const MAX_SPEED_KEY = "player_max_swing_speed";

export interface PredictNextVelocityParams {
  currentVelocity: Vector3;
  impulse?: Partial<Vector3>;
  dragXZ: number;
  dragY: number;
  gravity: number;
}

export function predictNextVelocity({
  currentVelocity,
  impulse,
  dragXZ,
  dragY,
  gravity,
}: PredictNextVelocityParams): Vector3 {
  const finalDragXZ = Math.max(0.0001, dragXZ);
  const finalDragY = Math.max(0.0001, dragY);

  const impX = impulse?.x ?? 0;
  const impY = impulse?.y ?? 0;
  const impZ = impulse?.z ?? 0;

  const appliedX = currentVelocity.x + impX;
  const appliedY = currentVelocity.y + impY;
  const appliedZ = currentVelocity.z + impZ;

  const nextX = appliedX * finalDragXZ;
  const nextY = (appliedY - gravity) * finalDragY;
  const nextZ = appliedZ * finalDragXZ;

  return { x: nextX, y: nextY, z: nextZ };
}

export function calculateNextTickVelocity(
  player: Player,
  anchor: Vector3,
  maxDistance: number,
): Vector3 | null {
  const currentDistance = Vector3Utils.distance(player.location, anchor);

  // 1. ロープがたるんでいる（最大長以内）場合はリセットして自由落下
  if (currentDistance < maxDistance || currentDistance < 0.0001) {
    PlayerStateManager.delete(player.id, MAX_SPEED_KEY);
    return null;
  }

  // 2. 幾何ベクトルの計算 (r: 相対位置, n: 法線単位ベクトル)
  const r = Vector3Utils.subtract(player.location, anchor);
  const n = Vector3Utils.normalize(r);

  // 3. 次Tickの自由予測速度を計算
  const nextVelocity = predictNextVelocity({
    currentVelocity: player.getVelocity(),
    dragXZ: 0,
    dragY: MINECRAFT_DRAG.air.y,
    gravity: MINECRAFT_GRAVITY,
  });

  // 4. 接線方向ベクトル（進行方向）の算出
  const vn = Vector3Utils.dot(nextVelocity, n);

  // 内側（中心向き）へ向かっている場合はロープが緩むのでリセット
  if (vn <= 0) {
    PlayerStateManager.delete(player.id, MAX_SPEED_KEY);
    return null;
  }

  // 接線成分を取り出す
  const vt = Vector3Utils.subtract(nextVelocity, Vector3Utils.scale(n, vn));
  const vtLength = Vector3Utils.magnitude(vt);

  // 接線方向の速度がほぼゼロの場合は維持できないため解除
  if (vtLength < 0.0001) {
    PlayerStateManager.delete(player.id, MAX_SPEED_KEY);
    return null;
  }

  // 接線方向の単位ベクトル（スイングの向き）
  const tangentDir = Vector3Utils.scale(vt, 1 / vtLength);

  // 5. 最高速度（最下点速度）の計算・取得
  // 最下点の Y 座標
  const bottomY = anchor.y - maxDistance;
  // 最下点からの現在の高さ
  const height = Math.max(0, player.location.y - bottomY);

  let maxSpeed = PlayerStateManager.get<number | undefined>(
    player.id,
    MAX_SPEED_KEY,
    undefined,
  );

  if (maxSpeed === undefined) {
    // 【ロープが張った初回】：力学的エネルギー保存則から最下点での最高速度を計算
    // v_max = sqrt(v_t^2 + 2 * g * h)
    maxSpeed = Math.sqrt(vtLength * vtLength + 2 * MINECRAFT_GRAVITY * height);
    PlayerStateManager.set(player.id, MAX_SPEED_KEY, maxSpeed);
  }

  // 6. 現在の高さにおける速さ (v = sqrt(v_max^2 - 2 * g * h)) を計算
  const speedSquared = maxSpeed * maxSpeed - 2 * MINECRAFT_GRAVITY * height;

  // 最高到達点を超えて速度が尽きた場合は、ロープがたるむのでリセット
  if (speedSquared <= 0) {
    PlayerStateManager.delete(player.id, MAX_SPEED_KEY);
    return null;
  }

  const currentSpeed = Math.sqrt(speedSquared);

  // 7. 接線単位ベクトルに現在の速さを掛けて最終ベクトルを決定
  return Vector3Utils.scale(tangentDir, currentSpeed);
}
