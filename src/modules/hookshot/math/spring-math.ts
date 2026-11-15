import { Vector3Utils } from "@minecraft/math";
import { Player, Vector3 } from "@minecraft/server";
import {
  BAUMGARTE_FACTOR,
  EPSILON,
  PROJECTION_FALLBACK_DISTANCE,
} from "../constants";
import {
  clampOutwardVelocity,
  convertTargetVelocityToImpulse,
  getAirDrag,
  getDirectionAndDistance,
  getNormalComponent,
  predictTickPhysics,
} from "./physics-utils";

export interface SpringPhysicsConfig {
  /** 限界長の下限値 (blocks) */
  minConstraintLength: number;
  /** 現在長に対する限界長倍率 */
  constraintLengthMultiplier: number;
  /** 動径方向の弾性係数 (ヤング率×断面積相当)。実効バネ定数は `stiffness / Math.max(naturalLength, minRadialDenominator)` */
  stiffness: number;
  /** 動径方向の速度減衰率 (0〜1)。大きいほど振動が早く収まる */
  damping: number;
  /** 1Tickあたりの最大加速度 (blocks/tick²)。急激な伸び縮みでの暴発防止 */
  maxAcceleration: number;
  /** 動径（縦）方向のひずみ計算時の分母下限値 (blocks) */
  minRadialDenominator: number;
  /** 曲げ（横）方向のひずみ計算時の分母下限値 (blocks) */
  minBendingDenominator: number;
  /** 曲げ方向の弾性係数。曲げひずみ `lateralOffset / bendingDenominator` に応じた復元力を計算します */
  bendingStiffness: number;
  /** 曲げひずみのべき乗指数 (1 = 線形, 2 = 2次プログレッシブ) */
  bendingPower: number;
  /** 曲げ方向の減衰率 (0〜1)。大きいほど横揺れが早く収まる */
  bendingDamping: number;
  /** 着弾面の裏側へめり込んだ際の反発倍率（effectiveStiffness に対する倍率） */
  surfacePenetrationMultiplier: number;
}

export interface SpringRopeParams
  extends Omit<
    SpringPhysicsConfig,
    "minConstraintLength" | "constraintLengthMultiplier"
  > {
  /** バネの自然長。これより伸びると引力、縮むと反発力（斥力）が働く */
  naturalLength: number;
  /** 限界長。これを超えると硬い拘束に切り替わる */
  maxLength?: number;
  /** 着弾面の法線ベクトル（面の裏側へのめり込み防止に使用。また bendingAxis 未指定時の基準軸としてもフォールバック利用される） */
  surfaceNormal?: Vector3;
  /**
   * 曲げバネの基準軸ベクトル（単位ベクトル）。
   * バネが横に曲げられた際、この軸方向へ引き戻す復元力が働く。
   * 指定がない場合は surfaceNormal が使用される。
   */
  bendingAxis?: Vector3;
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
    stiffness,
    damping,
    maxAcceleration,
    minRadialDenominator,
    minBendingDenominator,
    surfaceNormal,
    bendingAxis,
    bendingStiffness,
    bendingPower,
    bendingDamping,
    surfacePenetrationMultiplier,
  }: SpringRopeParams,
): Vector3 | null {
  const { dir: rawNormal, distance: r } = getDirectionAndDistance(
    anchor,
    player.location,
  );
  const referenceAxis = bendingAxis ?? surfaceNormal;
  // アンカーと足元が重なっている場合（真下撃ち等）は、微小な水平ズレで真横に飛ばないよう基準軸を使用する
  const normal =
    r >= PROJECTION_FALLBACK_DISTANCE
      ? rawNormal
      : (referenceAxis ?? { x: 0, y: 1, z: 0 });

  const currentVel = player.getVelocity();
  const speed = Vector3Utils.magnitude(currentVel);

  const vPred = predictTickPhysics({
    velocity: currentVel,
    dragXZ: getAirDrag(speed),
  });

  // ヤング率に基づく実効バネ定数（自然長が短いほど硬く、長いほど柔らかい）
  const radialDenominator = Math.max(naturalLength, minRadialDenominator);
  const bendingDenominator = Math.max(naturalLength, minBendingDenominator);
  const effectiveStiffness = stiffness / radialDenominator;

  // --- 双方向のバネ復元力（フックの法則＋ヤング率: a = -C * (r - L0) / L0） ---
  // stretch > 0 (伸びている): 内向き(-normal)に引く力
  // stretch < 0 (縮んでいる): 外向き(+normal)に押し出す力
  const stretch = r - naturalLength;
  const clampedStretchAccel = Math.min(
    effectiveStiffness * Math.abs(stretch),
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

  // --- 基準軸へ戻そうとする曲げバネ復元力 ---
  // 根本が固定されたバネが横に曲げられた時、基準軸（アンカー + s * axis）へ引き戻す力を加えます
  if (referenceAxis && bendingStiffness > 0) {
    const rVec = Vector3Utils.subtract(player.location, anchor);
    // 基準軸方向への射影長 s = r · referenceAxis
    const s = Vector3Utils.dot(rVec, referenceAxis);
    // 基準軸からの横ズレ（撓み）ベクトル r_perp = r - s * referenceAxis
    const rPerp = Vector3Utils.subtract(
      rVec,
      Vector3Utils.scale(referenceAxis, s),
    );
    const lateralOffset = Vector3Utils.magnitude(rPerp);

    if (lateralOffset > EPSILON) {
      const lateralDir = Vector3Utils.scale(rPerp, 1 / lateralOffset);
      const bendingStrain = lateralOffset / bendingDenominator;
      // 横ズレを戻す復元加速度（-lateralDir 方向）
      const clampedBendingAccel = Math.min(
        bendingStiffness * Math.pow(bendingStrain, bendingPower),
        maxAcceleration,
      );
      // 横ズレ方向の速度成分に対するダンピング（横揺れの収束）
      const lateralVel = Vector3Utils.dot(vPred, lateralDir);
      const lateralDampingAccel = lateralVel * bendingDamping;

      const totalLateralAccel = clampedBendingAccel + lateralDampingAccel;
      target = Vector3Utils.subtract(
        target,
        Vector3Utils.scale(lateralDir, totalLateralAccel),
      );
    }

    // 着弾面（surfaceNormal）の裏側、または基準軸の後ろ側にめり込んだ場合の反発力
    const pushNormal =
      surfaceNormal ?? (s < 0 ? referenceAxis : undefined);
    if (pushNormal) {
      const pushDot = Vector3Utils.dot(rVec, pushNormal);
      if (pushDot < 0) {
        const penetrationPush = Math.min(
          Math.abs(pushDot) * (effectiveStiffness * surfacePenetrationMultiplier),
          maxAcceleration,
        );
        target = Vector3Utils.add(
          target,
          Vector3Utils.scale(pushNormal, penetrationPush),
        );
      }
    }
  }

  // --- 限界長を超えたら硬い拘束 ---
  if (maxLength) {
    const penetration = Math.max(0, r - maxLength);
    if (penetration > 0) {
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
