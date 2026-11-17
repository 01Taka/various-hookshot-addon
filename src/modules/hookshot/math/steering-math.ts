import { Vector3Utils } from "@minecraft/math";
import { Player, Vector3 } from "@minecraft/server";
import { PlayerDirectionResolver } from "addon-utils";
import { PostFlightSystem } from "../../post-flight";
import {
  EPSILON,
  INPUT_DEADZONE,
  PLAYER_CHEST_HEIGHT_OFFSET,
} from "../constants";

export interface RigidSteeringConfig {
  /** 視線・A/D入力による接線方向ステアリング最大加速度 (blocks/tick²) */
  steerAccel: number;
  /** 最大回転パワーが得られる基準距離 (m) */
  referenceSwingDistance: number;
  /** アンカーより下にいるときの自動バンク上向き最大角度 (度) */
  maxUpwardBankDeg: number;
  /** 自動バンクが最大角度に達するアンカー仰角 (度) */
  bankFullElevationDeg: number;
  /** A/D入力なし時に最大加速(100%)へ到達する水平視線角度 (度) */
  fullSteerAngleDeg: number;
  /** 接線加速の減衰を開始する水平視線角度 (度) */
  steerFadeStartDeg: number;
  /** 接線加速が完全に0になる水平視線角度 (度) */
  steerFadeEndDeg: number;
  /** A/D入力優先に切り替わる移動入力の左右角度しきい値 (度) */
  adPriorityAngleDeg: number;
  /** 最大横旋回時に残す重力の最小比率 (0.0〜1.0, 例: 0.25 = 25%重力残存) */
  minGravityRatio: number;
  /** 自動バンク平面より下向きへ落下する速度成分の減衰率 (0.0〜1.0) */
  planeDownwardDamping: number;
  /** 遠心力による巻き取り減速が最大に達する基準遠心加速度 (blocks/tick²) */
  centrifugalReferenceAccel: number;
  /** 遠心力計算時の最小半径クランプ (blocks) */
  centrifugalMinRadius: number;
  /** 遠心力最大時の巻き取り速度の最小倍率 (0.0以上, 例: 0.25) */
  minReelSpeedMultiplier: number;
  /** たるみ判定の許容マージン (blocks) */
  slackDeadzone: number;
  /** スイングポンプの静止→スイング遷移開始水平速度 (blocks/tick) */
  pumpLowSpeedStart: number;
  /** スイングポンプの静止→スイング遷移完了水平速度 (blocks/tick) */
  pumpLowSpeedEnd: number;
}

/**
 * 自動バンク平面とステアリング計算の結果
 */
export interface RigidSteeringResult {
  /** 自動バンク平面上の旋回接線方向単位ベクトル */
  tangentDir: Vector3;
  /** 今Tickで接線方向に加算する回転加速度の大きさ (blocks/tick²) */
  tangentialAccel: number;
  /** 現在の横旋回出力比率 (0.0 〜 1.0) */
  steerRatio: number;
  /** 自動バンク平面の上向き単位法線ベクトル */
  planeNormal: Vector3;
  /** A/D入力優先が発動しているかどうか */
  hasADPriority: boolean;
}

interface BankedPlaneBasis {
  /** プレイヤーからアンカーへの距離 */
  distance: number;
  /** 水平面上のアンカー距離 */
  horizDist: number;
  /** 接近時（アンカー真上・真下付近）の特異点フェード係数 (0.0 〜 1.0) */
  horizFactor: number;
  /** アンカーへの水平単位ベクトル */
  toAnchorDirXZ: Vector3;
  /** 水平右方向単位ベクトル (V × U を正規化した方向) */
  rightDir: Vector3;
  /** 基本平面 P0 の上向き単位法線ベクトル */
  baseUpNormal: Vector3;
  /** 自動バンク角 (ラジアン, >= 0) */
  bankAngleRad: number;
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
 * プレイヤーの胸の位置を取得します。
 */
export function getPlayerChestLocation(player: Player): Vector3 {
  const pos = player.location;
  return { x: pos.x, y: pos.y + PLAYER_CHEST_HEIGHT_OFFSET, z: pos.z };
}

/**
 * アンカーとプレイヤー位置から、自動バンク平面の基底ベクトルとバンク角を計算します。
 * - アンカーより下（仰角 > 0）: 最大 +maxUpwardBankDeg まで上向きにバンク
 * - アンカーと同じ高さ〜上（仰角 <= 0）: バンク角 0°
 */
function computeBankedPlaneBasis(
  origin: Vector3,
  anchor: Vector3,
  steering: Pick<
    RigidSteeringConfig,
    "maxUpwardBankDeg" | "bankFullElevationDeg"
  >,
): BankedPlaneBasis | null {
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

  // 仰角に応じた自動バンク角 φ (B案: 仰角 > 0 のときのみ上向きバンク、<= 0 は 0°)
  const elevationRad = Math.atan2(toAnchorDir.y, horizLen);
  let bankAngleRad = 0;
  if (elevationRad > 0) {
    const maxBankRad = (steering.maxUpwardBankDeg * Math.PI) / 180;
    const fullElevRad = (steering.bankFullElevationDeg * Math.PI) / 180;
    const elevRatio =
      fullElevRad > EPSILON
        ? Math.min(1.0, elevationRad / fullElevRad)
        : 1.0;
    bankAngleRad = maxBankRad * elevRatio * horizFactor;
  }

  return {
    distance: r,
    horizDist,
    horizFactor,
    toAnchorDirXZ,
    rightDir,
    baseUpNormal,
    bankAngleRad,
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
 * 自動バンク平面に基づき、視線および A/D 移動キー入力から
 * 接線ステアリング加速度・旋回比率・バンク平面法線を計算します。
 */
export function calculateRigidSteering(
  player: Player,
  anchor: Vector3,
  steering: Pick<
    RigidSteeringConfig,
    | "steerAccel"
    | "referenceSwingDistance"
    | "maxUpwardBankDeg"
    | "bankFullElevationDeg"
    | "fullSteerAngleDeg"
    | "steerFadeStartDeg"
    | "steerFadeEndDeg"
    | "adPriorityAngleDeg"
  >,
): RigidSteeringResult {
  const basis = computeBankedPlaneBasis(player.location, anchor, steering);
  if (!basis) {
    return {
      tangentDir: { x: 0, y: 0, z: 0 },
      tangentialAccel: 0,
      steerRatio: 0,
      planeNormal: { x: 0, y: 1, z: 0 },
      hasADPriority: false,
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

  const cosPhi = Math.cos(basis.bankAngleRad);
  const sinPhi = Math.sin(basis.bankAngleRad);

  // 自動バンク平面上の接線方向単位ベクトル T_lat = turnSign * cos(φ) * R + sin(φ) * N0
  const tangentDir: Vector3 = {
    x: turnSign * cosPhi * basis.rightDir.x + sinPhi * basis.baseUpNormal.x,
    y: turnSign * cosPhi * basis.rightDir.y + sinPhi * basis.baseUpNormal.y,
    z: turnSign * cosPhi * basis.rightDir.z + sinPhi * basis.baseUpNormal.z,
  };

  // 自動バンク平面の上向き単位法線ベクトル N_P = -turnSign * sin(φ) * R + cos(φ) * N0
  const planeNormal: Vector3 = {
    x: -turnSign * sinPhi * basis.rightDir.x + cosPhi * basis.baseUpNormal.x,
    y: -turnSign * sinPhi * basis.rightDir.y + cosPhi * basis.baseUpNormal.y,
    z: -turnSign * sinPhi * basis.rightDir.z + cosPhi * basis.baseUpNormal.z,
  };

  if (steerRatio <= EPSILON) {
    return {
      tangentDir,
      tangentialAccel: 0,
      steerRatio: 0,
      planeNormal,
      hasADPriority,
    };
  }

  // 距離に応じた回転パワー減衰
  const distFactor = getDistanceRotationFactor(
    basis.distance,
    steering.referenceSwingDistance,
  );
  const effectiveAccel = steering.steerAccel * distFactor * steerRatio;

  return {
    tangentDir,
    tangentialAccel: effectiveAccel,
    steerRatio,
    planeNormal,
    hasADPriority,
  };
}

/**
 * アンカー着弾時に A/D が先行入力されている場合、
 * その入力と逆回転方向の速度成分を打ち消した速度ベクトルを返します。
 */
export function cancelPreInputReverseVelocity(
  player: Player,
  anchor: Vector3,
  velocity: Vector3,
  steering: Pick<
    RigidSteeringConfig,
    "maxUpwardBankDeg" | "bankFullElevationDeg" | "adPriorityAngleDeg"
  >,
): { velocity: Vector3; canceled: boolean } {
  const basis = computeBankedPlaneBasis(player.location, anchor, steering);
  if (!basis) {
    return { velocity, canceled: false };
  }

  const resolver = PlayerDirectionResolver.get(player);
  const inputVec = resolver.input.vector;
  const inputLen = Math.hypot(inputVec.x, inputVec.z);
  const adThresholdSin = Math.sin(
    (steering.adPriorityAngleDeg * Math.PI) / 180,
  );
  const hasADPriority =
    inputLen > INPUT_DEADZONE &&
    Math.abs(inputVec.x) / inputLen >= adThresholdSin;

  if (!hasADPriority) {
    return { velocity, canceled: false };
  }

  const turnSign = inputVec.x >= 0 ? 1 : -1;
  const desiredHorizRight: Vector3 = Vector3Utils.scale(
    basis.rightDir,
    turnSign,
  );

  let nextVel = velocity;
  let canceled = false;

  // 1. 水平面上の逆回転成分（desiredHorizRight と反対向き）を打ち消す
  const horizRotSpeed = Vector3Utils.dot(nextVel, desiredHorizRight);
  if (horizRotSpeed < 0) {
    nextVel = Vector3Utils.subtract(
      nextVel,
      Vector3Utils.scale(desiredHorizRight, horizRotSpeed),
    );
    canceled = true;
  }

  // 2. 自動バンク平面上の接線方向に対しても逆回転成分が残っていれば打ち消す
  const cosPhi = Math.cos(basis.bankAngleRad);
  const sinPhi = Math.sin(basis.bankAngleRad);
  const tangentDir: Vector3 = {
    x: turnSign * cosPhi * basis.rightDir.x + sinPhi * basis.baseUpNormal.x,
    y: turnSign * cosPhi * basis.rightDir.y + sinPhi * basis.baseUpNormal.y,
    z: turnSign * cosPhi * basis.rightDir.z + sinPhi * basis.baseUpNormal.z,
  };
  const tangentSpeed = Vector3Utils.dot(nextVel, tangentDir);
  if (tangentSpeed < 0) {
    nextVel = Vector3Utils.subtract(
      nextVel,
      Vector3Utils.scale(tangentDir, tangentSpeed),
    );
    canceled = true;
  }

  return { velocity: nextVel, canceled };
}

/**
 * 自動バンク平面上の接線方向速度（遠心力）に基づいてロープ短縮速度の補正倍率を計算します。
 *
 * - 平面上の接線速度 v_t による遠心力 (v_t² / max(r, centrifugalMinRadius)) が強いほど巻き取り速度が低下
 * - 巻き取り速度は minReelSpeedMultiplier（0以上）まで低下し、負の値にはならない
 * - ロープがたるんでいる（slack）間は、まずテンションを張るために 1.0（通常速度）を返す
 */
export function calculateReelSpeedMultiplier(
  player: Player,
  anchor: Vector3,
  currentLength: number | undefined,
  steering: Pick<
    RigidSteeringConfig,
    | "maxUpwardBankDeg"
    | "bankFullElevationDeg"
    | "centrifugalReferenceAccel"
    | "centrifugalMinRadius"
    | "minReelSpeedMultiplier"
    | "slackDeadzone"
  >,
): number {
  const basis = computeBankedPlaneBasis(player.location, anchor, steering);
  if (!basis) return 1.0;

  // ロープがたるんでいる間は通常速度で巻き取る
  if (
    currentLength !== undefined &&
    basis.distance < currentLength - steering.slackDeadzone
  ) {
    return 1.0;
  }

  const velocity = player.getVelocity();
  const horizVelDotRight = Vector3Utils.dot(velocity, basis.rightDir);
  const turnSign = horizVelDotRight >= 0 ? 1 : -1;

  const cosPhi = Math.cos(basis.bankAngleRad);
  const sinPhi = Math.sin(basis.bankAngleRad);

  // 自動バンク平面上の接線方向単位ベクトル
  const planeTangentDir: Vector3 = {
    x: turnSign * cosPhi * basis.rightDir.x + sinPhi * basis.baseUpNormal.x,
    y: turnSign * cosPhi * basis.rightDir.y + sinPhi * basis.baseUpNormal.y,
    z: turnSign * cosPhi * basis.rightDir.z + sinPhi * basis.baseUpNormal.z,
  };

  // 平面上の接線方向への移動速度 v_t と遠心力 a_c = v_t² / max(r, r_min)
  const tangentialSpeed = Math.abs(Vector3Utils.dot(velocity, planeTangentDir));
  const effectiveRadius = Math.max(
     EPSILON,
    steering.centrifugalMinRadius,
    basis.distance,
  );
  const centrifugalAccel =
    (tangentialSpeed * tangentialSpeed) / effectiveRadius;

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
