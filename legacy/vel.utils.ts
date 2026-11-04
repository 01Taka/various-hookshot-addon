import { MINECRAFT_DRAG, MINECRAFT_GRAVITY } from "addon-utils";
import { predictNextVelocity } from "./pendulum-calculations.utils";
import { Vector3Utils } from "@minecraft/math";

export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface RopePhysicsParams {
  readonly currentPos: Vector3;
  readonly currentVel: Vector3;
  readonly anchorPos: Vector3;
  readonly targetRadius: number;
  readonly gravity: Vector3;
  readonly dt: number;
  readonly tau?: number; // 緩和時間（デフォルト: 0.15）
  readonly maxPullSpeed?: number; // 最大引き寄せ速度（デフォルト: 25.0）
}

export interface RopeSolverParams {
  currentPos: Vector3;
  currentVel: Vector3;
  anchorPos: Vector3;
  targetRadius: number;
  gravity: Vector3;
  dt: number;
  tau?: number;
  maxPullSpeed?: number;
}

const EPSILON = 0.0001;

// --- ベクトル演算ヘルパー ---
const vecAdd = (a: Vector3, b: Vector3): Vector3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});
const vecSub = (a: Vector3, b: Vector3): Vector3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});
const vecScale = (v: Vector3, s: number): Vector3 => ({
  x: v.x * s,
  y: v.y * s,
  z: v.z * s,
});
const vecDot = (a: Vector3, b: Vector3): number =>
  a.x * b.x + a.y * b.y + a.z * b.z;
const vecLengthSq = (v: Vector3): number => vecDot(v, v);
const vecLength = (v: Vector3): number => Math.sqrt(vecLengthSq(v));

const vecNormalize = (v: Vector3): Vector3 => {
  const len = vecLength(v);
  return len > EPSILON ? vecScale(v, 1 / len) : { x: 0, y: 0, z: 0 };
};

// --- 単一責任に基づいた各計算モジュール ---

/**
 * 責務 1: 外力（重力）による無拘束時の自由落下状態を仮予測する
 */
const predictFreeMotion = (
  pos: Vector3,
  vel: Vector3,
  gravity: Vector3,
  dt: number,
): { predictedPos: Vector3; predictedVel: Vector3 } => {
  const predictedVel = predictNextVelocity({
    currentVelocity: vel,
    dragY: MINECRAFT_DRAG.air.y,
    dragXZ: 1,
    gravity: gravity.y,
  });
  const predictedPos = vecAdd(pos, predictedVel);
  return { predictedPos, predictedVel };
};

/**
 * 責務 2: 予測位置を円周（球面上）に投影し、向心力による旋回方向ベクトルを算出する
 */
const computeSwingDirection = (
  currentPos: Vector3,
  anchorPos: Vector3,
  toPredicted: Vector3,
  predictedRadius: number,
  targetRadius: number,
): Vector3 => {
  const predictedRadialDir = vecScale(toPredicted, 1 / predictedRadius);
  const constrainedPos = vecAdd(
    anchorPos,
    vecScale(predictedRadialDir, targetRadius),
  );
  const swingDelta = vecSub(constrainedPos, currentPos);
  return vecNormalize(swingDelta);
};

/**
 * 責務 3: 外向き速度の損失を差し引き、幾何学的減衰を排除した速度スカラーを算出する
 */
const computePreservedSpeed = (
  predictedVel: Vector3,
  currentRadialDir: Vector3,
): number => {
  const outwardSpeed = vecDot(predictedVel, currentRadialDir);

  if (outwardSpeed > 0) {
    const tangentialSqr = Math.max(
      0,
      vecLengthSq(predictedVel) - outwardSpeed * outwardSpeed,
    );
    return Math.sqrt(tangentialSqr);
  }

  return vecLength(predictedVel);
};

/**
 * 責務 4: 目標半径を超過した偏差を解消するための引き寄せ速度ベクトルを算出する
 */
const computeRadialRecoveryVelocity = (
  currentRadius: number,
  targetRadius: number,
  currentRadialDir: Vector3,
  tau: number,
  maxPullSpeed: number,
): Vector3 => {
  const excess = currentRadius - targetRadius;
  if (excess <= 0) {
    return { x: 0, y: 0, z: 0 };
  }

  const effectiveTau = Math.max(tau, EPSILON);
  const pullSpeed = Math.min(excess / effectiveTau, maxPullSpeed);

  return vecScale(currentRadialDir, -pullSpeed);
};

// --- 公開エントリーポイント ---

/**
 * 振り子拘束および巻き取りを考慮した次tickの速度ベクトルを算出する純粋関数
 */
export function solveNextVelocity({
  currentPos,
  currentVel,
  anchorPos,
  targetRadius,
  gravity,
  dt,
  tau = 0.15,
  maxPullSpeed = 25.0,
}: RopeSolverParams): Vector3 {
  if (dt <= EPSILON) return { ...currentVel };

  const toCurrent = vecSub(currentPos, anchorPos);
  const currentRadius = vecLength(toCurrent);

  // 特異点回避（アンカーと現在位置が極めて近い場合）
  if (currentRadius < EPSILON) {
    return vecAdd(currentVel, vecScale(gravity, dt));
  }

  const currentRadialDir = vecScale(toCurrent, 1 / currentRadius);

  // 1. 自由落下の仮予測
  const { predictedPos, predictedVel } = predictFreeMotion(
    currentPos,
    currentVel,
    gravity,
    dt,
  );

  const toPredicted = vecSub(predictedPos, anchorPos);
  const predictedRadius = vecLength(toPredicted);

  // 2. ロープがたるんでいる場合はそのまま自由落下速度を返却
  if (predictedRadius <= targetRadius) {
    return predictedVel;
  }

  // 3. 接線方向の旋回速度の算出
  const swingDir = computeSwingDirection(
    currentPos,
    anchorPos,
    toPredicted,
    predictedRadius,
    targetRadius,
  );
  const preservedSpeed = computePreservedSpeed(predictedVel, currentRadialDir);
  const swingVel = vecScale(swingDir, preservedSpeed);

  // 4. 動径方向の引き寄せ補正の合成
  const radialRecoveryVel = computeRadialRecoveryVelocity(
    currentRadius,
    targetRadius,
    currentRadialDir,
    tau,
    maxPullSpeed,
  );

  return swingVel; // vecAdd(swingVel, radialRecoveryVel);
}

export interface ScaledTangentRopeParams {
  readonly currentPos: Vector3;
  readonly currentVel: Vector3;
  readonly anchorPos: Vector3;
  readonly gravity: Vector3;
  readonly dt: number;
  readonly reelSpeed?: number; // 巻き取り速度 u (m/s, デフォルト: 0)
}

/**
 * 接線方向を正規化し、スカラー積分した接線速度を乗算して次tickの速度を求める関数
 */
export function solveNextVelocityFromTangentDirection({
  currentPos,
  currentVel,
  anchorPos,
  gravity,
  dt,
  reelSpeed = 0,
}: ScaledTangentRopeParams): Vector3 {
  if (dt <= EPSILON) return { ...currentVel };

  const toPlayer = vecSub(currentPos, anchorPos);
  const radius = vecLength(toPlayer);

  // 特異点回避（アンカーと現在地がほぼ同一点の場合）
  if (radius < EPSILON) {
    return vecAdd(currentVel, vecScale(gravity, dt));
  }

  // 1. 動径方向の単位ベクトル (中心から外向き: r_hat)
  const radialDir = vecScale(toPlayer, 1 / radius);

  // 2. 接線方向ベクトルの抽出と正規化 (t_hat)
  const currentRadialSpeed = vecDot(currentVel, radialDir);
  const rawTangentVel = vecSub(
    currentVel,
    vecScale(radialDir, currentRadialSpeed),
  );
  const currentTangentSpeed = vecLength(rawTangentVel);

  // 3. 接線加速度 a_tangent = -g * sin(theta) のスカラー算出
  // 重力ベクトルの接線成分を求め、現在のスイング方向（rawTangentVel）との内積で符号付きスカラー化
  const gravityRadial = vecDot(gravity, radialDir);
  const gravityTangentVec = vecSub(gravity, vecScale(radialDir, gravityRadial));

  let tangentUnitDir: Vector3;
  let nextTangentSpeed: number;

  if (currentTangentSpeed > EPSILON) {
    // 既存の進行方向を基準として接線ベクトルを正規化
    tangentUnitDir = vecScale(rawTangentVel, 1 / currentTangentSpeed);

    // 進行方向に対する接線加速度（符号付きスカラー）
    const tangentAccelScalar = vecDot(gravityTangentVec, tangentUnitDir);

    // オイラー法による接線スカラー速度の更新: v(t + dt) = v(t) + a * dt
    nextTangentSpeed = currentTangentSpeed + tangentAccelScalar * dt;
  } else {
    // 静止状態からのフォールバック: 重力の接線成分の向きを初動方向とする
    const gravTangentLen = vecLength(gravityTangentVec);
    if (gravTangentLen > EPSILON) {
      tangentUnitDir = vecScale(gravityTangentVec, 1 / gravTangentLen);
      nextTangentSpeed = gravTangentLen * dt;
    } else {
      tangentUnitDir = { x: 0, y: 0, z: 0 };
      nextTangentSpeed = 0;
    }
  }

  // 4. 正規化接線ベクトルに更新後のスカラー速度を乗算 (反転時の符号もそのまま反映)
  const nextTangentVel = vecScale(tangentUnitDir, nextTangentSpeed);

  // 5. 巻き取り速度（動径方向の内向き速度: -u * r_hat）を合成
  const nextRadialVel = vecScale(radialDir, -reelSpeed);

  return vecAdd(nextTangentVel, nextRadialVel);
}

export function mySolveVelocity({
  currentPos,
  currentVel,
  anchorPos,
  distance,
}: {
  currentPos: Vector3;
  currentVel: Vector3;
  anchorPos: Vector3;
  distance: number;
}) {
  const gravity = { x: 0, y: MINECRAFT_GRAVITY, z: 0 };
  const { perpendicular: gravityPerpendicular } =
    decomposeVectorRelativeToPoint(anchorPos, currentPos, gravity, distance);
  const newVel = Vector3Utils.add(currentVel, gravityPerpendicular);
  const { perpendicular: nextVelocity, isTowardsTarget } =
    decomposeVectorRelativeToPoint(anchorPos, currentVel, newVel, distance);
  return isTowardsTarget ? null : nextVelocity;
}

/**
 * 基準点に対するベクトルの分解・解析結果
 */
interface RelativeVectorDecomposition {
  /** 基準点方向と平行な成分ベクトル（正射影） */
  parallel: Vector3;
  /** 基準点方向成分の大きさ（符号付きスカラー: 正なら基準点方向、負なら逆方向） */
  parallelLength: number;
  /** 基準点に対して直交する成分ベクトル */
  perpendicular: Vector3;
  /** 直交成分の大きさ（スカラー） */
  perpendicularLength: number;
  /**
   * ベクトルが基準点方向を向いているかどうか
   * （速度なら「接近中」、加速度・力なら「引き寄せ・推進中」を意味します）
   */
  isTowardsTarget: boolean;
}

/**
 * 任意の基準点に対するベクトル（速度、加速度、力など）を、
 * ターゲット方向の成分（平行）と直交成分に分解する
 *
 * @param targetPos 基準となる目標位置（ターゲット、アンカー、原点など）
 * @param currentPos ベクトルの作用点・現在位置
 * @param vector 分解したいベクトル（速度、加速度、フォースなど）
 */
function decomposeVectorRelativeToPoint(
  targetPos: Vector3,
  currentPos: Vector3,
  vector: Vector3,
  overwriteDistance?: number,
): RelativeVectorDecomposition {
  // 作用点から基準点へ向かうベクトル
  const toTarget = Vector3Utils.subtract(currentPos, targetPos);

  // 同一座標の場合のゼロ除算対策
  const distance =
    overwriteDistance ?? Vector3Utils.distance(currentPos, targetPos);
  if (distance === 0) {
    const zero = Vector3Utils.scale(vector, 0);
    return {
      parallel: zero,
      parallelLength: 0,
      perpendicular: vector,
      perpendicularLength: Vector3Utils.magnitude(vector),
      isTowardsTarget: false,
    };
  }

  const dirToTarget = Vector3Utils.scale(toTarget, 1 / distance);

  // 基準点方向への正射影成分（符号付きスカラー）
  const parallelLength = Vector3Utils.dot(vector, dirToTarget);

  // 1. 平行成分（ターゲットに向かう/遠ざかるベクトル）
  const parallel = Vector3Utils.scale(dirToTarget, parallelLength);

  // 2. 直交成分（ターゲットに対して横を向くベクトル）
  const perpendicular = Vector3Utils.subtract(vector, parallel);

  return {
    parallel,
    parallelLength,
    perpendicular,
    perpendicularLength: Vector3Utils.magnitude(perpendicular),
    isTowardsTarget: parallelLength > 0,
  };
}
