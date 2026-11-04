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

// 問題点: 速度を一定に保とうとするため、壁に激突しても、速度が維持されたままになる
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

// 問題点: 距離が短くなるとそれが新しい長さに自動で成ってしまう
// がくつきが大きい、減速が大きい
export function calculateVariableTetherVelocity(
  player: Player,
  anchor: Vector3,
  currentLength: number,
  targetLength: number,
  reelSpeed: number,
): { velocity: Vector3 | null; nextLength: number } {
  const currentVel = player.getVelocity();
  const currentPos = player.location;

  // 1. ロープ目標長の更新（巻き取り / 伸ばし）
  let newLength = currentLength;
  let reelingRadialVelocity = 0; // 巻き取り時に要求される内向き速度

  if (currentLength > targetLength) {
    // 巻き取り中：目標長を縮め、内向き速度を許容/要求（負の値）
    newLength = Math.max(targetLength, currentLength - reelSpeed);
    reelingRadialVelocity = -(currentLength - newLength);
  } else if (currentLength < targetLength) {
    // 伸ばし中（正の値）
    newLength = Math.min(targetLength, currentLength + reelSpeed);
    reelingRadialVelocity = newLength - currentLength;
  }

  // 2. 幾何ベクトルの計算
  const rVec = Vector3Utils.subtract(currentPos, anchor);
  const r = Vector3Utils.magnitude(rVec);
  if (r < 0.0001) return { velocity: null, nextLength: newLength };
  const n = Vector3Utils.scale(rVec, 1 / r); // 外向き単位ベクトル

  // 3. 次Tickの予測速度（重力とMinecraftの標準空気抵抗を適用）
  const drag = MINECRAFT_DRAG.air.y; // 約 0.98
  const vPred: Vector3 = {
    x: currentVel.x * drag,
    y: (currentVel.y - MINECRAFT_GRAVITY) * drag,
    z: currentVel.z * drag,
  };

  // 4. 動径方向（外向き）の速度成分を抽出
  const vn = Vector3Utils.dot(vPred, n);

  // 1Tick後の予測距離
  const predDistance = r + vn;

  // たるんでいる、または内側に向かって飛んでいる場合は自由落下
  if (predDistance <= newLength && vn <= reelingRadialVelocity) {
    return { velocity: null, nextLength: newLength };
  }

  // 5. 【重要：自己加速の防止】
  // 余計な位置引き戻し速度（上向きブースト）を一切足さず、
  // 「許容される動径速度を超えて外側に向かう速度成分（excessVn）」だけを削る
  const excessVn = vn - reelingRadialVelocity;

  if (excessVn > 0) {
    // 外向きの超過分だけを差し引く（純粋な射影）
    // 数学的に |resultVelocity| <= |vPred| となるため、絶対に自己加速しない
    const resultVelocity = Vector3Utils.subtract(
      vPred,
      Vector3Utils.scale(n, excessVn),
    );
    return { velocity: resultVelocity, nextLength: newLength };
  }

  return { velocity: null, nextLength: newLength };
}

export interface SwingResult {
  velocity: Vector3 | null;
  nextLength: number;
  isDetached: boolean; // ロープが外れたフラグ
}

// export function calculateDynamicTetherVelocity(
//   player: Player,
//   anchor: Vector3,
//   currentLength: number,
//   isReeling: boolean, // 巻き取り入力中かどうか
//   reelImpulse: number = 0.2, // 巻き取りインパルスの強さ (blocks/tick)
// ): SwingResult {
//   const currentVel = player.getVelocity();
//   const currentPos = player.location;

//   // 1. 幾何ベクトルの計算
//   const rVec = Vector3Utils.subtract(currentPos, anchor);
//   const r = Vector3Utils.magnitude(rVec);

//   // アンカーに近すぎる場合は終了（ゼロ除算・めり込み防止）
//   if (r < 1.0) {
//     return { velocity: null, nextLength: currentLength, isDetached: true };
//   }
//   const n = Vector3Utils.scale(rVec, 1 / r); // 外向き単位ベクトル

//   // 2. 【アイデア1】外れ判定（スナップ）
//   // 許容限界（currentLength + 0.6）を超えていたら、引き戻さずに外す！
//   const snapDistance = currentLength + 0.6;
//   if (r > snapDistance) {
//     return { velocity: null, nextLength: currentLength, isDetached: true };
//   }

//   // 3. 次Tickの予測速度（重力とドラッグ）
//   const drag = MINECRAFT_DRAG.air.y;
//   let vPred: Vector3 = {
//     x: currentVel.x * drag,
//     y: (currentVel.y - MINECRAFT_GRAVITY) * drag,
//     z: currentVel.z * drag,
//   };

//   // 4. 【アイデア2】巻き取り時は中心方向（-n）へインパルスを加える
//   if (isReeling) {
//     vPred = Vector3Utils.subtract(vPred, Vector3Utils.scale(n, reelImpulse));
//   }

//   // 5. 動径方向の速度をチェック
//   const vn = Vector3Utils.dot(vPred, n);

//   // たるみ判定：底面（currentLength - 0.3）より内側で中心に向かっているなら自由落下
//   const bottom = currentLength - 0.3;
//   if (r < bottom && vn <= 0) {
//     // 実際に近づいた分、ロープの最大長を縮めておく
//     const nextLen = Math.min(currentLength, r);
//     return { velocity: null, nextLength: nextLen, isDetached: false };
//   }

//   // 6. ロープが張っている場合：外向きの速度（vn > 0）だけをゼロにする
//   let resultVelocity = vPred;
//   if (vn > 0) {
//     resultVelocity = Vector3Utils.subtract(vPred, Vector3Utils.scale(n, vn));
//   }

//   // 7. 【実績距離の採用】
//   // 巻き取りによって実際にアンカーに近づいた場合は、新しい距離を次のロープ長に採用
//   // （※勝手に伸びてしまわないよう Math.min でクランプ）
//   const nextLen = Math.min(currentLength, r);

//   return {
//     velocity: resultVelocity,
//     nextLength: nextLen,
//     isDetached: false,
//   };
// }

// export function calculateVariableVelocity(
//   player: Player,
//   anchor: Vector3,
//   currentLength: number,
//   targetLength: number,
//   reelSpeed: number,
// ): { velocity: Vector3 | null; nextLength: number } {
//   const currentVel = player.getVelocity();
//   const currentPos = player.location;

//   // 1. ロープ目標長の更新
//   let newLength = currentLength;
//   let reelingRadialVelocity = 0;
//   if (currentLength > targetLength) {
//     newLength = Math.max(targetLength, currentLength - reelSpeed);
//     reelingRadialVelocity = -(currentLength - newLength);
//   } else if (currentLength < targetLength) {
//     newLength = Math.min(targetLength, currentLength + reelSpeed);
//     reelingRadialVelocity = newLength - currentLength;
//   }

//   // 2. 幾何ベクトルの計算
//   const rVec = Vector3Utils.subtract(currentPos, anchor);
//   const r = Vector3Utils.magnitude(rVec);
//   if (r < 0.0001) return { velocity: null, nextLength: newLength };
//   const n = Vector3Utils.scale(rVec, 1 / r);

//   // ★ 2重しきい値の設定（0.3ブロックの遊びゾーン）
//   const top = newLength;
//   const bottom = newLength - 0.3;

//   // 3. 次Tickの予測速度（重力とドラッグ）
//   const drag = MINECRAFT_DRAG.air.y;
//   const vPred: Vector3 = {
//     x: currentVel.x * drag,
//     y: (currentVel.y - MINECRAFT_GRAVITY) * drag,
//     z: currentVel.z * drag,
//   };

//   const vn = Vector3Utils.dot(vPred, n);

//   // 4. 【ゾーン判定】
//   // ① bottom より内側、かつアンカーに向かって飛んでいるなら「完全にたるんだ」として自由落下
//   if (r < bottom && vn <= reelingRadialVelocity) {
//     return { velocity: null, nextLength: newLength };
//   }

//   // ② スイング維持ゾーン または top超過ゾーン（拘束を継続）
//   // 接線成分の抽出
//   let vt = Vector3Utils.subtract(vPred, Vector3Utils.scale(n, vn));

//   // 動径方向の速度（通常は0、巻き取り中は負）
//   let targetVn = reelingRadialVelocity;

//   // ③ top を超えている場合（はみ出し時）：少し強めに内側へ戻す補正
//   if (r > top) {
//     const overshoot = r - top;
//     // はみ出た分を中心へ戻す速度（0.25程度のマイルドな係数）
//     targetVn -= overshoot * 0.25;
//   }

//   // 接線速度 + 動径速度 を合成して返す
//   const resultVelocity = Vector3Utils.add(vt, Vector3Utils.scale(n, targetVn));

//   return { velocity: resultVelocity, nextLength: newLength };
// }

// 問題点 がくつきが大きい。減速がとても大きい
/**
 * 物理演算に基づき、ロープ拘束を満たす次のTickの目標速度を計算します。
 *
 * @param currentPos プレイヤーの現在位置（ロープ接続点: 胸部）
 * @param currentVel プレイヤーの現在の速度 (blocks/tick)
 * @param anchor アンカーブロックの中心座標
 * @param maxDistance ロープの最大長 L
 * @param dragXZ 水平方向の空気/水抵抗保持率
 * @param dragY 垂直方向の空気/水抵抗保持率
 * @param gravity 重力加速度 (blocks/tick)
 * @returns 次のTickで到達すべき目標速度ベクトル
 */
export function calculateNextTickTetherVelocity(
  currentPos: Vector3,
  currentVel: Vector3,
  anchor: Vector3,
  maxDistance: number,
  dragXZ: number,
  dragY: number,
  gravity: number,
): Vector3 | null {
  // 1. 次Tickの自由予測速度 (Minecraft Bedrock の環境物理による減衰と重力)
  const vFree: Vector3 = {
    x: currentVel.x * dragXZ,
    y: (currentVel.y - gravity) * dragY,
    z: currentVel.z * dragXZ,
  };

  // 2. 次Tickの自由予測位置
  const predPos: Vector3 = {
    x: currentPos.x + vFree.x,
    y: currentPos.y + vFree.y,
    z: currentPos.z + vFree.z,
  };

  // 3. アンカーから予測位置への相対ベクトルおよび予測距離
  const rx = predPos.x - anchor.x;
  const ry = predPos.y - anchor.y;
  const rz = predPos.z - anchor.z;
  const predDistance = Math.hypot(rx, ry, rz);

  // 4. ロープがたるんでいる（最大長以内）場合は外力不要（自由落下・運動を維持）
  if (predDistance <= maxDistance || predDistance < 0.0001) {
    return vFree;
  }

  // 5. ロープが張っている（最大長を超える）場合：
  // 拘束面（半径 maxDistance の球面）上の目標位置へ射影
  const scale = maxDistance / predDistance;
  const targetNextPos: Vector3 = {
    x: anchor.x + rx * scale,
    y: anchor.y + ry * scale,
    z: anchor.z + rz * scale,
  };

  // 6. 1Tick で targetNextPos に到達するための必要速度: vNext = targetNextPos - currentPos
  const vNext: Vector3 = {
    x: targetNextPos.x - currentPos.x,
    y: targetNextPos.y - currentPos.y,
    z: targetNextPos.z - currentPos.z,
  };

  // 自由予測速度との差分がある場合（ロープが張った状態）のみインパルスを計算して適用
  const rrx = currentPos.x + currentVel.x * dragXZ - anchor.x;
  const rry = currentPos.y + (currentVel.y - gravity) * dragY - anchor.y;
  const rrz = currentPos.z + currentVel.z * dragXZ - anchor.z;
  const predictedDist = Math.hypot(rrx, rry, rrz);

  if (predictedDist > maxDistance) return null;

  return vNext;
}

const GRAVITY = 0.08; // Minecraftの標準重力加速度 (blocks/tick)
const DRAG = 1; // 空気抵抗保持率 (blocks/tick)

// 問題点: なめらかに移動せず、上下にぴょんぴょん跳ねてしまう
/**
 * 速度射影（Velocity Projection）を用いたロープ拘束速度を計算します。
 *
 * @param player 対象のプレイヤー
 * @param anchor アンカーブロックの中心座標
 * @param maxLength ロープの最大長（固定長）
 * @returns 拘束が必要な場合の目標速度。たるんでいる（自由落下）時は null
 */
export function calculateSimpleTetherVelocity(
  player: Player,
  anchor: Vector3,
  maxLength: number,
): Vector3 | null {
  const currentPos = player.location;
  const currentVel = player.getVelocity();

  // 1. 次Tickの自由落下速度を予測
  const vPred: Vector3 = {
    x: currentVel.x * DRAG,
    y: (currentVel.y - GRAVITY) * DRAG,
    z: currentVel.z * DRAG,
  };

  // 2. 次Tickの予測位置
  const predPos: Vector3 = {
    x: currentPos.x + vPred.x,
    y: currentPos.y + vPred.y,
    z: currentPos.z + vPred.z,
  };

  // 3. アンカーから予測位置へのベクトルと予測距離
  const rx = predPos.x - anchor.x;
  const ry = predPos.y - anchor.y;
  const rz = predPos.z - anchor.z;
  const predDist = Math.hypot(rx, ry, rz);

  // 4. ロープがたるんでいる場合（最大長以内）はMinecraft本体の物理に任せる
  if (predDist <= maxLength || predDist < 0.0001) {
    return null;
  }

  // 5. 予測位置における法線単位ベクトル（外向き）
  const nx = rx / predDist;
  const ny = ry / predDist;
  const nz = rz / predDist;

  // 6. 予測速度の動径成分（外向きの速度）
  const vn = vPred.x * nx + vPred.y * ny + vPred.z * nz;

  // 7. 【改善1：がくつき解消】位置誤差の引き戻し（Baumgarte安定化）
  // 1Tickで外側にはみ出す距離（predDist - maxLength）を押し戻す補正速度
  // 1.0 だと剛体ロープのように瞬時に引き戻し、0.8 程度にすると柔らかい挙動になります
  const penetration = predDist - maxLength;
  const correctionSpeed = penetration * 1.0;

  // 外向き速度 + はみ出し分 を打ち消す速度（インパルス）
  const totalCorrection = vn + correctionSpeed;

  // 内向きにすでに飛んでいる場合は余計な力を加えない
  if (totalCorrection <= 0) {
    return null;
  }

  // 接線方向へ射影（法線成分を除去）
  let vx = vPred.x - nx * totalCorrection;
  let vy = vPred.y - ny * totalCorrection;
  let vz = vPred.z - nz * totalCorrection;

  // 8. 【改善2：激しい減速の解消】速さの再正規化（速度保存）
  // 離散時間計算では「直線で曲面を近似」するため毎Tick速度が削られます。
  // スイングの勢いを自然に保つため、自由予測時の速さ（エネルギー）を維持します。
  const originalSpeed = Math.hypot(vPred.x, vPred.y, vPred.z);
  const currentSpeed = Math.hypot(vx, vy, vz);

  if (currentSpeed > 0.0001 && originalSpeed > 0.0001) {
    const scale = originalSpeed / currentSpeed;
    vx *= scale;
    vy *= scale;
    vz *= scale;
  }

  return { x: vx, y: vy, z: vz };
}

// =================================================================
// 3. 汎用物理・幾何ユーティリティ（切り出した関数群）
// =================================================================

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

function getAirDrag(speed: number) {
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
export function calculateFixedTetherVelocity(
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

export function calculateFixedTetherVelocity2(
  player: Player,
  anchor: Vector3,
  maxDistance: number,
): Vector3 | null {
  // 1. アンカーからの方向と距離
  const { dir: normal, distance: r } = getDirectionAndDistance(
    anchor,
    player.location,
  );
  if (r < 0.0001) return null;

  // 2. 次Tickの自由予測速度
  const currentVel = player.getVelocity();
  const vPred = predictTickPhysics({ velocity: currentVel });
  const originalSpeed = Vector3Utils.magnitude(vPred); // ★元の速さを記録

  // 3. 外向き法線成分と予測距離
  const vn = getNormalComponent(vPred, normal);
  const predDistance = r + vn;

  // 4. はみ出しに応じた引き戻し速度（Baumgarte）
  const BAUMGARTE_FACTOR = 0.15;
  const penetration = Math.max(0, r - maxDistance);
  const pullBackSpeed = penetration * BAUMGARTE_FACTOR;

  // 5. たるみ判定
  if (penetration === 0 && predDistance <= maxDistance && vn <= 0) {
    return null;
  }

  // 6. 外向き成分をカットし、引き戻し方向を含めた暫定速度を計算
  const candidateVelocity = clampOutwardVelocity(vPred, normal, -pullBackSpeed);

  // =================================================================
  // ★ 7. 自己加速・エリトラ暴走の完全防止（エネルギー保存制約）
  // =================================================================
  const candidateSpeed = Vector3Utils.magnitude(candidateVelocity);

  // 引き戻しを足したことで元の速さより大きくなってしまった場合、
  // 「向き（曲がる角度）」は維持したまま「元の速さ」までスケールダウンする
  if (candidateSpeed > originalSpeed && candidateSpeed > 0.0001) {
    return Vector3Utils.scale(
      candidateVelocity,
      originalSpeed / candidateSpeed,
    );
  }

  return candidateVelocity;
}
