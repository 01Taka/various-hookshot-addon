import { Vector3 } from "@minecraft/server";
import {
  AirProbingCapable,
  AirProbingState,
  BaseHookshotDefinition,
  BaseHookshotState,
  ContinuousReelState,
  ReelCapable,
  RetractCapable,
  RetractState,
} from "../types";

export const SPRING_HOOKSHOT_ID = "spring";

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
  /** 基準軸へ戻る向き (tangentVel > 0) の減衰倍率 (デフォルト 4.0) */
  bendingReturnDampingMultiplier?: number;
  /** 横方向付近（θ ≧ 90°）での曲げ復元加速度の上限 (blocks/tick², 未指定時は制限なし) */
  horizontalBendingMaxAccel?: number;
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
  /** Baumgarte 位置誤差安定化係数 */
  baumgarteFactor: number;
  /** 着弾面の法線ベクトル（面の裏側へのめり込み防止に使用。また bendingAxis 未指定時の基準軸としてもフォールバック利用される） */
  surfaceNormal?: Vector3;
  /**
   * 曲げバネの基準軸ベクトル（単位ベクトル）。
   * バネが横に曲げられた際、この軸方向へ引き戻す復元力が働く。
   * 指定がない場合は surfaceNormal が使用される。
   */
  bendingAxis?: Vector3;
}

export interface SpringHookshotState
  extends BaseHookshotState<typeof SPRING_HOOKSHOT_ID>,
    AirProbingState,
    RetractState,
    ContinuousReelState {
  /** アンカーからプレイヤーへ向かう、フック着弾（刺さった）瞬間の初期方向ベクトル（単位ベクトル） */
  initialDirection?: Vector3;
  /** minRopeLength 未満で着弾した際、minRopeLength まで自動伸長中かどうか */
  isAutoExtendingToMin?: boolean;
  /** 手動伸長中の前Tickにおけるアンカーからの距離 (blocks) */
  lastExtendDistance?: number;
  /** 最後に縮め操作を行ったTick (縮め中の曲げ減衰ブースト用) */
  lastShortenTick?: number;
  /** 縮め中の曲げ減衰ブーストの現在ブレンド率 (0.0〜1.0) */
  shortenDampingBlend?: number;
}

export interface SpringAutoExtendToMinConfig {
  /** minRopeLength 未満で着弾した際に minRopeLength まで自動で伸ばす速度 (blocks/tick) */
  speed: number;
}

export interface SpringShortenCompressionBrakeConfig {
  /** 圧縮量（currentLength - distance）1ブロックあたりの短縮速度減衰係数 */
  brakePerBlock: number;
  /** 圧縮時の最低短縮速度倍率（0〜1） */
  minSpeedMultiplier: number;
}

export interface SpringShortenBendingDampingConfig {
  /** 縮めている間に適用する強い曲げ減衰率 (0〜1) */
  boostedDamping: number;
  /** ブーストの立ち上がりにかかる時間 (ticks) */
  rampUpTicks: number;
  /** ブーストの立ち下がり（元の値へ戻るまで）にかかる時間 (ticks) */
  rampDownTicks: number;
}

export type SpringBendingMode = "shot_angle" | "surface_normal";

export interface SpringHookshotDefinition
  extends BaseHookshotDefinition<
      typeof SPRING_HOOKSHOT_ID,
      SpringHookshotState
    >,
    ReelCapable,
    AirProbingCapable,
    RetractCapable {
  /** 圧縮状態で手動伸長する際、外向き移動量に追従して距離差が縮まないように伸ばすか */
  matchOutwardExtend: boolean;
  /** minRopeLength 未満で着弾した際に minRopeLength まで自動で伸ばす設定 */
  autoExtendToMin: SpringAutoExtendToMinConfig;
  /** 圧縮状態（distance < currentLength）で短縮する際の速度ブレーキ設定 */
  shortenCompressionBrake: SpringShortenCompressionBrakeConfig;
  /** 縮め操作中および直後の曲げ減衰ブースト設定 */
  shortenBendingDamping: SpringShortenBendingDampingConfig;
  /** 曲げ復元力の基準モード ("shot_angle" | "surface_normal") */
  bendingMode: SpringBendingMode;
  /** バネの物理パラメータ */
  physics: SpringPhysicsConfig;
  /** ワイヤー描画時の基準軸（法線または曲げ軸）を解決するコールバック */
  getWireAxis: (state: SpringHookshotState) => Vector3 | undefined;
}

/**
 * バネの曲げ復元力（角度維持）の基準モード
 * - "shot_angle": 刺さった瞬間の角度・方向を維持（新仕様）
 * - "surface_normal": 着弾面の法線方向（垂直）を維持（従来の仕様）
 */