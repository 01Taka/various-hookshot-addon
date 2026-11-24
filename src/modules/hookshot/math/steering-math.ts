import { Vector3Utils } from "@minecraft/math";
import { Player, Vector3 } from "@minecraft/server";
import { PlayerDirectionResolver } from "addon-utils";
import { PostFlightSystem } from "../../post-flight";
import {
  EPSILON,
  INPUT_DEADZONE,
} from "../constants";

export interface RigidSteeringConfig {
  /** 視線・A/D入力による水平接線方向ステアリング最大加速度（エアロベスト装着時, blocks/tick²） */
  steerAccel: number;
  /** 視線・A/D入力による水平接線方向ステアリング最大加速度（エアロベスト未装着時, blocks/tick²） */
  steerAccelNormal?: number;
  /** 最大回転パワーが得られる基準距離 (m) */
  referenceSwingDistance: number;
  /** A/D入力なし時に最大加速(100%)へ到達する水平視線角度 (度) */
  fullSteerAngleDeg: number;
  /** 接線加速の減衰を開始する水平視線角度 (度) */
  steerFadeStartDeg: number;
  /** 接線加速が完全に0になる水平視線角度 (度) */
  steerFadeEndDeg: number;
  /** A/D入力優先に切り替わる移動入力の左右角度しきい値 (度) */
  adPriorityAngleDeg: number;
  /** 3D遠心力が最大基準に達する遠心加速度 (blocks/tick²) */
  centrifugal3DReferenceAccel: number;
  /** 近づく＋下側で接線ベクトルを上向きに回転させる最大角度 (度) */
  maxUpwardTiltDeg: number;
  /** 上向き回転が最大に達するアンカー仰角 (度) */
  tiltFullElevationDeg: number;
  /** 上向き回転が遠距離へ減衰する半減距離 (blocks, tiltFullDistance からこの距離離れるごとに半分) */
  tiltHalfDistance: number;
  /** 上向き回転が距離要因で最大に達する距離 (blocks) */
  tiltFullDistance: number;
  /** 1Tickあたりの接線速度ベクトルの回転追従率 (0.0〜1.0) */
  tiltRatePerTick: number;
  /** アンカーより上に到達してから回転変更効果が0%へ減衰するまでのTick数 */
  aboveAnchorDecayTicks: number;
  /** 遠心力による巻き取り減速が最大に達する基準遠心加速度 (blocks/tick²) */
  centrifugalReferenceAccel: number;
  /** 巻き取り減速の遠心力計算における横方向（R軸）速度2乗の重み */
  reelCentrifugalHorizWeight: number;
  /** 巻き取り減速の遠心力計算における縦方向（N0軸）速度2乗の重み */
  reelCentrifugalVertWeight: number;
  /** 遠心力計算時の最小半径クランプ (blocks) */
  centrifugalMinRadius: number;
  /** 横遠心力最大時の巻き取り速度の最小倍率 (0.0以上, 例: 0.25) */
  minReelSpeedMultiplier: number;
  /** たるみ判定の許容マージン (blocks) */
  slackDeadzone: number;
  /** スイングポンプの静止→スイング遷移開始水平速度 (blocks/tick) */
  pumpLowSpeedStart: number;
  /** スイングポンプの静止→スイング遷移完了水平速度 (blocks/tick) */
  pumpLowSpeedEnd: number;
}

/**
 * 接線ステアリングおよび3D遠心力計算の結果
 */
export interface RigidSteeringResult {
  /** 現在の左右旋回方向の水平接線単位ベクトル */
  lateralDir: Vector3;
  /** ロープに直交する上向き単位法線ベクトル */
  upNormal: Vector3;
  /** 今Tickで水平接線方向に加算する加速度の大きさ (blocks/tick²) */
  tangentialAccel: number;
  /** 現在の横旋回出力比率 (0.0 〜 1.0) */
  steerRatio: number;
  /** 現在の3D遠心力比率 (0.0 〜 1.0) */
  centrifugal3DRatio: number;
  /** 近づく＋下側に応じた目標の上向き回転角 (ラジアン, >= 0) */
  targetTiltRad: number;
  /** プレイヤーがアンカーより下（仰角 > 0）にいるかどうか */
  isBelowAnchor: boolean;
}

interface SteeringPlaneBasis {
  /** プレイヤーからアンカーへの距離 */
  distance: number;
  /** 水平面上のアンカー距離 */
  horizDist: number;
  /** 接近時（アンカー真上・真下付近）の特異点フェード係数 (0.0 〜 1.0) */
  horizFactor: number;
  /** アンカーへの3D単位ベクトル */
  toAnchorDir: Vector3;
  /** アンカーへの水平単位ベクトル */
  toAnchorDirXZ: Vector3;
  /** 水平右方向単位ベクトル (V × U を正規化した方向) */
  rightDir: Vector3;
  /** V と R に直交する上向き単位法線ベクトル N0 */
  baseUpNormal: Vector3;
  /** プレイヤーからアンカーへの仰角 (ラジアン) */
  elevationRad: number;
}

/** アンカー真上・真下の特異点フェード距離 (blocks) */
const HORIZ_SINGULARITY_FADE_DISTANCE = 2.0;

/**
 * 視線・移動入力によるステアリングボーナスが利用可能かを判定します。
 * エアロベスト系チェストプレートを有効な状態（残り耐久 > 1）で装備している場合のみ true を返します。
 */
export function canUseGazeSteering(player: Player): boolean {
  return PostFlightSystem.getEquippedVestInfo(player) !== null;
}

/**
 * アンカーより上に滞在した累計Tick数から、回転方向変更効果の減衰係数 (0.0 〜 1.0) を計算します。
 * - aboveAnchorDecayTicks かけて 1.0 → 0.0 へ線形減衰
 */
export function calculateAboveAnchorDecayFactor(
  aboveAnchorTicks: number,
  steering: Pick<RigidSteeringConfig, "aboveAnchorDecayTicks">,
): number {
  if (steering.aboveAnchorDecayTicks <= EPSILON) {
    return 0.0;
  }
  return Math.max(0.0, 1.0 - aboveAnchorTicks / steering.aboveAnchorDecayTicks);
}

/**
 * 距離に応じた回転パワー係数 (0.0 〜 1.0) を取得します。
 */
export function getDistanceRotationFactor(
  distance: number,
  referenceSwingDistance: number,
): number {
  if (distance <= referenceSwingDistance) {
    return 1.0;
  }
  return referenceSwingDistance / distance;
}

/**
 * アンカーとプレイヤー位置から、旋回・接線空間の基底ベクトルを計算します。
 */
function computeSteeringBasis(
  origin: Vector3,
  anchor: Vector3,
): SteeringPlaneBasis | null {
  const diff = Vector3Utils.subtract(anchor, origin);
  const r = Vector3Utils.magnitude(diff);
  if (r < EPSILON) return null;

  const toAnchorDir = Vector3Utils.scale(diff, 1 / r);
  const horizDist = Math.hypot(diff.x, diff.z);
  const horizLen = Math.hypot(toAnchorDir.x, toAnchorDir.z);
  if (horizDist < EPSILON || horizLen < EPSILON) {
    return null;
  }

  const horizFactor = Math.min(
    1.0,
    horizDist / HORIZ_SINGULARITY_FADE_DISTANCE,
  );

  // 水平面上のアンカー方向単位ベクトル H
  const toAnchorDirXZ: Vector3 = {
    x: toAnchorDir.x / horizLen,
    y: 0,
    z: toAnchorDir.z / horizLen,
  };

  // V × U に対応する水平右方向単位ベクトル R = (-Hz, 0, Hx)
  const rightDir: Vector3 = {
    x: -toAnchorDirXZ.z,
    y: 0,
    z: toAnchorDirXZ.x,
  };

  // V と R に直交する上向き単位法線ベクトル N0 = -Vy * H + horizLen * U
  const baseUpNormal: Vector3 = {
    x: -toAnchorDir.y * toAnchorDirXZ.x,
    y: horizLen,
    z: -toAnchorDir.y * toAnchorDirXZ.z,
  };

  const elevationRad = Math.atan2(toAnchorDir.y, horizLen);

  return {
    distance: r,
    horizDist,
    horizFactor,
    toAnchorDir,
    toAnchorDirXZ,
    rightDir,
    baseUpNormal,
    elevationRad,
  };
}

/**
 * 水平視線角度と A/D 入力状態から、台形カーブに基づく接線加速比率 (0.0 〜 1.0) を計算します。
 * - A/D なし: 0°→45° で 0%→100%、45°→90° で 100%、90°→110° で 100%→0%、110°以上で 0%
 * - A/D あり: 0°→90° で 100%、90°→110° で 100%→0%、110°以上で 0%
 */
function calculateTrapezoidSteerRatio(
  thetaYawRad: number,
  hasADPriority: boolean,
  steering: Pick<
    RigidSteeringConfig,
    "fullSteerAngleDeg" | "steerFadeStartDeg" | "steerFadeEndDeg"
  >,
): number {
  const fadeStartRad = (steering.steerFadeStartDeg * Math.PI) / 180;
  const fadeEndRad = (steering.steerFadeEndDeg * Math.PI) / 180;

  if (thetaYawRad >= fadeEndRad) {
    return 0;
  }

  let fadeOut = 1.0;
  if (thetaYawRad > fadeStartRad) {
    const fadeSpan = Math.max(EPSILON, fadeEndRad - fadeStartRad);
    fadeOut = Math.max(0, (fadeEndRad - thetaYawRad) / fadeSpan);
  }

  if (hasADPriority) {
    return fadeOut;
  }

  const fullSteerRad = (steering.fullSteerAngleDeg * Math.PI) / 180;
  if (fullSteerRad <= EPSILON || thetaYawRad >= fullSteerRad) {
    return fadeOut;
  }

  const rampUp = Math.sin((thetaYawRad / fullSteerRad) * (Math.PI / 2));
  return rampUp * fadeOut;
}

/**
 * 視線および A/D 移動キー入力から水平接線ステアリング加速度・3D遠心力比率・目標上昇回転角を計算します。
 */
export function calculateRigidSteering(
  player: Player,
  anchor: Vector3,
  steering: Pick<
    RigidSteeringConfig,
    | "steerAccel"
    | "steerAccelNormal"
    | "referenceSwingDistance"
    | "fullSteerAngleDeg"
    | "steerFadeStartDeg"
    | "steerFadeEndDeg"
    | "adPriorityAngleDeg"
    | "centrifugal3DReferenceAccel"
    | "centrifugalMinRadius"
    | "maxUpwardTiltDeg"
    | "tiltFullElevationDeg"
    | "tiltHalfDistance"
    | "tiltFullDistance"
  >,
  hasAeroVest: boolean = true,
): RigidSteeringResult {
  const basis = computeSteeringBasis(player.location, anchor);
  if (!basis) {
    return {
      lateralDir: { x: 0, y: 0, z: 0 },
      upNormal: { x: 0, y: 1, z: 0 },
      tangentialAccel: 0,
      steerRatio: 0,
      centrifugal3DRatio: 0,
      targetTiltRad: 0,
      isBelowAnchor: false,
    };
  }

  const resolver = PlayerDirectionResolver.get(player);
  const rot = player.getRotation();
  const yawRad = (rot.y * Math.PI) / 180;

  // プレイヤーの水平視線方向ベクトル（上下ピッチに関わらず安定した水平向きを取得）
  const lookDirXZ: Vector3 = {
    x: -Math.sin(yawRad),
    y: 0,
    z: Math.cos(yawRad),
  };

  // アンカー水平方向との角度差 θ_yaw (0 〜 PI)
  const cosYaw = Math.max(
    -1,
    Math.min(1, Vector3Utils.dot(lookDirXZ, basis.toAnchorDirXZ)),
  );
  const thetaYawRad = Math.acos(cosYaw);

  // 視線がアンカーに対して右か左か (右: +1, 左: -1)
  const gazeRightDot = Vector3Utils.dot(lookDirXZ, basis.rightDir);
  const gazeSign = gazeRightDot >= 0 ? 1 : -1;

  // A/D 入力の判定（入力角度が左右に adPriorityAngleDeg 以上なら A/D 方向を優先）
  const inputVec = resolver.input.vector;
  const inputLen = Math.hypot(inputVec.x, inputVec.z);
  const adThresholdSin = Math.sin(
    (steering.adPriorityAngleDeg * Math.PI) / 180,
  );
  const hasADPriority =
    inputLen > INPUT_DEADZONE &&
    Math.abs(inputVec.x) / inputLen >= adThresholdSin;

  // 90°〜110° の減衰区間でもカメラローカルの A/D 符号（D=+1, A=-1）を使うことで逆回転を防止
  const turnSign = hasADPriority ? (inputVec.x >= 0 ? 1 : -1) : gazeSign;

  // 台形カーブによる旋回比率 (0.0 〜 1.0)
  const rawSteerRatio = calculateTrapezoidSteerRatio(
    thetaYawRad,
    hasADPriority,
    steering,
  );
  const steerRatio = rawSteerRatio * basis.horizFactor;

  const lateralDir = Vector3Utils.scale(basis.rightDir, turnSign);

  // 3D 接線速度ベクトル v_t3D の大きさと 3D 遠心力比率 (0.0 〜 1.0)
  const velocity = player.getVelocity();
  const vRadial = Vector3Utils.dot(velocity, basis.toAnchorDir);
  const vTangent3D = Vector3Utils.subtract(
    velocity,
    Vector3Utils.scale(basis.toAnchorDir, vRadial),
  );
  const tangentialSpeed3D = Vector3Utils.magnitude(vTangent3D);
  const effectiveRadius = Math.max(
    EPSILON,
    steering.centrifugalMinRadius,
    basis.distance,
  );
  const centrifugalAccel3D =
    (tangentialSpeed3D * tangentialSpeed3D) / effectiveRadius;
  const refAccel3D = Math.max(EPSILON, steering.centrifugal3DReferenceAccel);
  const centrifugal3DRatio = Math.min(1.0, centrifugalAccel3D / refAccel3D);

  // 近づくほど × アンカーより下にいる（仰角 > 0）ほど大きくなる上向き回転目標角
  const isBelowAnchor = basis.elevationRad > 0;
  let targetTiltRad = 0;
  if (isBelowAnchor && centrifugal3DRatio > 0) {
    const distDiff = Math.max(0, basis.horizDist - steering.tiltFullDistance);
    const distProximity =
      steering.tiltHalfDistance > EPSILON
        ? Math.pow(0.5, distDiff / steering.tiltHalfDistance)
        : distDiff <= 0
          ? 1.0
          : 0.0;
    const fullElevRad = (steering.tiltFullElevationDeg * Math.PI) / 180;
    const elevFactor =
      fullElevRad > EPSILON
        ? Math.min(1.0, basis.elevationRad / fullElevRad)
        : 1.0;
    const maxTiltRad = (steering.maxUpwardTiltDeg * Math.PI) / 180;
    targetTiltRad =
      maxTiltRad *
      distProximity *
      elevFactor *
      centrifugal3DRatio *
      basis.horizFactor;
  }

  // 距離に応じた回転パワー減衰（未装着時は控えめな横ステアリングのみ）
  const distFactor = getDistanceRotationFactor(
    basis.distance,
    steering.referenceSwingDistance,
  );
  const baseSteerAccel = hasAeroVest
    ? steering.steerAccel
    : (steering.steerAccelNormal ?? steering.steerAccel);
  const effectiveAccel =
    steerRatio > EPSILON ? baseSteerAccel * distFactor * steerRatio : 0;

  return {
    lateralDir,
    upNormal: basis.baseUpNormal,
    tangentialAccel: effectiveAccel,
    steerRatio,
    centrifugal3DRatio: hasAeroVest ? centrifugal3DRatio : 0,
    targetTiltRad: hasAeroVest ? targetTiltRad : 0,
    isBelowAnchor,
  };
}

/**
 * 水平横方向（R軸）および縦方向（N0軸）の重み付き接線速度による遠心力に基づいて
 * ロープ短縮速度の補正倍率を計算します。
 *
 * - 重み付き遠心力 ((w_h * v_horiz² + w_v * v_vert²) / max(r, centrifugalMinRadius)) が強いほど巻き取り速度が低下
 * - 巻き取り速度は minReelSpeedMultiplier（0以上）まで低下し、負の値にはならない
 * - ロープがたるんでいる（slack）間は、まずテンションを張るために 1.0（通常速度）を返す
 */
export function calculateReelSpeedMultiplier(
  player: Player,
  anchor: Vector3,
  currentLength: number | undefined,
  steering: Pick<
    RigidSteeringConfig,
    | "centrifugalReferenceAccel"
    | "reelCentrifugalHorizWeight"
    | "reelCentrifugalVertWeight"
    | "centrifugalMinRadius"
    | "minReelSpeedMultiplier"
    | "slackDeadzone"
  >,
): number {
  const basis = computeSteeringBasis(player.location, anchor);
  if (!basis) return 1.0;

  // ロープがたるんでいる間は通常速度で巻き取る
  if (
    currentLength !== undefined &&
    basis.distance < currentLength - steering.slackDeadzone
  ) {
    return 1.0;
  }

  const velocity = player.getVelocity();
  const horizTangentialSpeed = Vector3Utils.dot(velocity, basis.rightDir);
  const vertTangentialSpeed = Vector3Utils.dot(velocity, basis.baseUpNormal);
  const weightedSpeedSq =
    Math.max(0, steering.reelCentrifugalHorizWeight) *
      horizTangentialSpeed *
      horizTangentialSpeed +
    Math.max(0, steering.reelCentrifugalVertWeight) *
      vertTangentialSpeed *
      vertTangentialSpeed;

  const effectiveRadius = Math.max(
    EPSILON,
    steering.centrifugalMinRadius,
    basis.distance,
  );
  const centrifugalAccel = weightedSpeedSq / effectiveRadius;

  const refAccel = Math.max(EPSILON, steering.centrifugalReferenceAccel);
  const centrifugalRatio = Math.min(1.0, centrifugalAccel / refAccel);
  const minMultiplier = Math.max(
    0,
    Math.min(1.0, steering.minReelSpeedMultiplier),
  );

  return Math.max(
    minMultiplier,
    1.0 - centrifugalRatio * (1.0 - minMultiplier),
  );
}

/**
 * 非巻き取り時の振り子スイング用・接線追加加速度を計算します。
 *
 * 円錐状の旋回（アンカー水平方向と接線速度が直交）での無限加速を防ぐため、
 * 水平面（XZ）上で「アンカー方向」「移動入力方向」「接線速度方向」が平行に近いほど強く効き、
 * 接線方向から離れるほど cos² カーブで滑らかに減衰します。
 */
export function calculatePendulumPumpAcceleration(
  player: Player,
  normal: Vector3,
  velocity: Vector3,
  pumpAccel: number,
  lowSpeedStart: number,
  lowSpeedEnd: number,
): Vector3 {
  if (pumpAccel <= 0) return { x: 0, y: 0, z: 0 };

  const resolver = PlayerDirectionResolver.get(player);
  const input = resolver.input;
  const inputLen = Math.hypot(input.vector.x, input.vector.z);
  if (inputLen <= INPUT_DEADZONE) return { x: 0, y: 0, z: 0 };

  // 現在地からアンカーへの水平ベクトル（normal は anchor -> player のため反転）
  const toAnchorX = -normal.x;
  const toAnchorZ = -normal.z;
  const horizDist = Math.hypot(toAnchorX, toAnchorZ);
  if (horizDist < INPUT_DEADZONE) return { x: 0, y: 0, z: 0 };

  const toAnchorDirXZ: Vector3 = {
    x: toAnchorX / horizDist,
    y: 0,
    z: toAnchorZ / horizDist,
  };

  // 入力方向をプレイヤーの向き基準でワールド水平方向へ変換
  const rot = player.getRotation();
  const yawRad = (rot.y * Math.PI) / 180;
  const alpha = Math.atan2(input.vector.x, input.vector.z);
  const cosA = Math.cos(alpha);
  const sinA = Math.sin(alpha);
  const inputDirXZ: Vector3 = {
    x: cosA * -Math.sin(yawRad) + sinA * -Math.cos(yawRad),
    y: 0,
    z: cosA * Math.cos(yawRad) + sinA * -Math.sin(yawRad),
  };

  // 静止〜低速時はアンカー水平方向と入力方向の平行度（cos²）で漕ぎ出しを許可
  const cosAnchorInput = Vector3Utils.dot(toAnchorDirXZ, inputDirXZ);
  const standstillFactor = cosAnchorInput * cosAnchorInput;

  // 現在の接線速度の水平成分を取得
  const vn = Vector3Utils.dot(velocity, normal);
  const vtVec = Vector3Utils.subtract(velocity, Vector3Utils.scale(normal, vn));
  const vtHorizLen = Math.hypot(vtVec.x, vtVec.z);

  let alignmentFactor = standstillFactor;
  if (vtHorizLen > EPSILON) {
    const vtDirXZ: Vector3 = {
      x: vtVec.x / vtHorizLen,
      y: 0,
      z: vtVec.z / vtHorizLen,
    };
    const cosAnchorVel = Vector3Utils.dot(toAnchorDirXZ, vtDirXZ);
    const cosInputVel = Math.max(0, Vector3Utils.dot(inputDirXZ, vtDirXZ));
    // 振り子度（cos²φ） × 入力と進行方向の一致度（cos²θ）
    const swingFactor =
      cosAnchorVel * cosAnchorVel * (cosInputVel * cosInputVel);

    // 静止状態からスイング状態へ滑らかにブレンド
    const span = Math.max(EPSILON, lowSpeedEnd - lowSpeedStart);
    const blend = Math.max(
      0,
      Math.min(1, (vtHorizLen - lowSpeedStart) / span),
    );
    alignmentFactor = standstillFactor * (1 - blend) + swingFactor * blend;
  }

  if (alignmentFactor <= EPSILON) return { x: 0, y: 0, z: 0 };

  // 入力方向をロープの接線平面へ射影し、3D接線方向の推進力を生成
  const inputDotNormal = Vector3Utils.dot(inputDirXZ, normal);
  const tangentPush = Vector3Utils.subtract(
    inputDirXZ,
    Vector3Utils.scale(normal, inputDotNormal),
  );
  const tangentPushLen = Vector3Utils.magnitude(tangentPush);
  if (tangentPushLen < EPSILON) return { x: 0, y: 0, z: 0 };

  const inputMag = Math.min(1.0, inputLen);
  return Vector3Utils.scale(
    tangentPush,
    (pumpAccel * inputMag * alignmentFactor) / tangentPushLen,
  );
}
