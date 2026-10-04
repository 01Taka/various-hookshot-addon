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
  const currentVel = player.getVelocity();
  const currentSpeed = Vector3Utils.magnitude(currentVel);

  let maxSpeed = PlayerStateManager.get<number | undefined>(
    player.id,
    MAX_SPEED_KEY,
    undefined,
  );

  // 【改善1】たるみ判定にマージン（遊び）を設ける
  // スイング中（maxSpeedが存在する時）は、弦による内側への潜り込み（約0.2ブロック）を許容する
  const slackTolerance = maxSpeed !== undefined ? 0.3 : 0.0;
  if (
    currentDistance < maxDistance - slackTolerance ||
    currentDistance < 0.0001
  ) {
    PlayerStateManager.delete(player.id, MAX_SPEED_KEY);
    return null;
  }

  // 法線単位ベクトル (アンカーからプレイヤーへの外向き)
  const r = Vector3Utils.subtract(player.location, anchor);
  const n = Vector3Utils.normalize(r);

  // 【改善2】dragXZ は減衰なしなら 1.0 (0だと水平速度が消滅する)
  const nextVelocity = predictNextVelocity({
    currentVelocity: currentVel,
    dragXZ: 1.0, // または MINECRAFT_DRAG.air.x
    dragY: MINECRAFT_DRAG.air.y,
    gravity: MINECRAFT_GRAVITY,
  });

  // 接線成分の抽出
  const vn = Vector3Utils.dot(nextVelocity, n);
  let vt = Vector3Utils.subtract(nextVelocity, Vector3Utils.scale(n, vn));
  let vtLength = Vector3Utils.magnitude(vt);

  // 【改善3】真下で重力と法線が平行になり vt が潰れた場合、現在の速度（慣性）から接線を作る
  let tangentDir: Vector3;
  if (vtLength < 0.001) {
    // 現在の速度の法線成分を抜いて接線方向を復元
    const curVn = Vector3Utils.dot(currentVel, n);
    const curVt = Vector3Utils.subtract(
      currentVel,
      Vector3Utils.scale(n, curVn),
    );
    const curVtLength = Vector3Utils.magnitude(curVt);

    if (curVtLength < 0.001) {
      // 完全に静止して真下にぶら下がっている場合
      PlayerStateManager.delete(player.id, MAX_SPEED_KEY);
      return null;
    }
    tangentDir = Vector3Utils.scale(curVt, 1 / curVtLength);
  } else {
    tangentDir = Vector3Utils.scale(vt, 1 / vtLength);
  }

  // 高さの計算
  const bottomY = anchor.y - maxDistance;
  const height = Math.max(0, player.location.y - bottomY);

  if (maxSpeed === undefined) {
    // 【初回：張った瞬間】外向きに動いている時だけ張る
    if (vn <= 0) {
      return null; // 内向きにすれ違っただけなら張らない
    }
    const initSpeed = Math.max(currentSpeed, vtLength);
    maxSpeed = Math.sqrt(
      initSpeed * initSpeed + 2 * MINECRAFT_GRAVITY * height,
    );
    PlayerStateManager.set(player.id, MAX_SPEED_KEY, maxSpeed);
  }

  // 現在の高さにおける速さ
  const speedSquared = maxSpeed * maxSpeed - 2 * MINECRAFT_GRAVITY * height;

  // 最高到達点で速度が尽きたらたるむ
  if (speedSquared <= 0) {
    PlayerStateManager.delete(player.id, MAX_SPEED_KEY);
    return null;
  }

  const targetSpeed = Math.sqrt(speedSquared);

  // 接線方向に目標速度を乗算して返す
  return Vector3Utils.scale(tangentDir, targetSpeed);
}
