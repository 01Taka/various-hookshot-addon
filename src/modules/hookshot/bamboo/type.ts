import { Vector3 } from "@minecraft/server";
import {
  AirProbingCapable,
  AirProbingState,
  BaseHookshotDefinition,
  BaseHookshotState,
  ReelCapable,
  RetractCapable,
  RetractState,
  StepReelState,
} from "../types";

export const BAMBOO_HOOKSHOT_ID = "bamboo";

export interface BambooPhysicsConfig {
  /**
   * しなり具合・柔軟度 (flexibility)
   * 1.0 が標準。値が大きいほど柔らかく深くしなり、値が小さいほど硬くしなりにくくなります。
   * compressionStiffness が未指定の場合、`baseStiffnessFactor / flexibility` として計算されます。
   */
  flexibility: number;
  /** flexibility から実効バネ定数を算出する基準係数 (blocks/tick² per block) */
  baseStiffnessFactor: number;
  /** 圧縮時の弾性バネ定数（直接指定する場合のオーバーライド用） */
  compressionStiffness?: number;
  /** 最大しなり量（ブロック数）。竹がこれ以上縮まない限界圧縮量 */
  maxCompression?: number;
  /**
   * 伸ばす際に接線方向（竹のしなり解消方向）へ振り分けるエネルギー比率 (0.0〜1.0)
   * 外向きに伸びる際（vn > 0）、動径反発力の一部をパーティクルのしなり解消方向へ配分し、跳躍やスイングを加速させます。
   */
  tangentTransferRatio: number;
  /** 動径方向の速度減衰率 (0〜1)。振動の収束 */
  damping: number;
  /** 1Tickあたりの最大反発加速度 (blocks/tick²) */
  maxAcceleration: number;
  /**
   * 上方向反発の減衰を開始する上向き比率の閾値 (0.0〜1.0, sin(仰角))
   * 例: 0.5 = 仰角30°より上向きの反発から減衰を開始
   */
  upwardDecayThreshold: number;
  /** 真上方向 (上向き比率 1.0) の反発における最小倍率 (0.0〜1.0) */
  upwardMinScale: number;
  /** 上方向反発減衰カーブの指数 (1.0で線形、値が大きいほど真上付近で急激に減衰) */
  upwardDecayExponent: number;
  /** 伸び切り時 (r >= naturalLength) の外向き速度保持率 (0.0〜1.0) */
  stretchOutwardRetention: number;
  /** 伸び切り時 (r >= naturalLength) の水平速度 (X/Z) 保持率 (0.0〜1.0) */
  stretchHorizontalRetention: number;
}

export interface BambooPhysicsParams extends BambooPhysicsConfig {
  /** 竹ポールの自然長（現在のロープ長） */
  naturalLength: number;
  /** 着弾面の法線ベクトル（パーティクルと完全同期したしなり方向の計算に使用） */
  surfaceNormal?: Vector3;
}


/**
 * 竹フックショットの空中連続使用状態
 */
export interface BambooAirChainState {
  /** 着地せずに竹を使用した回数 (0: 未使用/接地済み, 1: 1回使用済み, 2: 2回使用済み...) */
  count: number;
  /** 現在竹フックに接続中かどうか */
  isHooked: boolean;
  /** 竹使用後に空中（非接地）にいたかどうか */
  hasBeenAirborne: boolean;
}

export interface BambooAirChainBonusConfig {
  /** 水平方向（X/Z 軸の走る速度）の接近速度に応じたしなりボーナス係数 (blocks per block/tick) */
  speedFlexBonusFactorXZ: number;
  /** 鉛直方向（Y 軸の落下・上昇速度）の接近速度に応じたしなりボーナス係数 (blocks per block/tick) */
  speedFlexBonusFactorY: number;
  /** 速度しなりボーナスの最大追加長 (blocks) */
  maxSpeedFlexBonus: number;
  /** 空中2回目以降のしなりボーナス倍率 (0.0〜1.0) */
  consecutiveAirBonusDecayRate: number;
}

export interface BambooTautSoundConfig {
  /** 竹がピンと張って減衰を開始するタイミングのSE */
  soundId: string;
  /** 竹がピンと張ったときのSEピッチ */
  pitch: number;
  /** 竹がピンと張ったときのSE音量 */
  volume: number;
}

export interface BambooHookshotState
  extends BaseHookshotState<typeof BAMBOO_HOOKSHOT_ID>,
    AirProbingState,
    RetractState,
    StepReelState {}

export interface BambooHookshotDefinition
  extends BaseHookshotDefinition<
      typeof BAMBOO_HOOKSHOT_ID,
      BambooHookshotState
    >,
    ReelCapable,
    AirProbingCapable,
    RetractCapable {
  /** 自然長を超えて指定距離 (blocks) 以上伸びた場合に自動でアンカーを解除する */
  maxOverstretchDistance: number;
  /** 自動解除時の効果音ID */
  detachSoundId: string;
  /** 竹ポールの弾性・反発・しなり物理パラメータ */
  physics: BambooPhysicsConfig;
  /** 着弾時の速度に応じたしなりボーナス設定 */
  airChainBonus: BambooAirChainBonusConfig;
  /** 竹がピンと張ったときの効果音設定 */
  tautSound: BambooTautSoundConfig;
}