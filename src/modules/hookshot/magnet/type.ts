import { Player, Vector3 } from "@minecraft/server";
import { BaseHookshotDefinition, BaseHookshotState } from "../types";

export const MAGNET_HOOKSHOT_ID = "magnet";

export type MagnetForceMode = "none" | "attract" | "repel";

export interface MagnetPhysicsConfig {
  /** 最大効果ゾーンの上限距離 (blocks, 50m) */
  fullEffectDistance: number;
  /** 減衰ゾーンの上限距離 / 効果0になる距離 (blocks, 80m) */
  zeroEffectDistance: number;
  /** 引き寄せ開始時の初速 (blocks/tick) */
  attractInitialSpeed: number;
  /** 引き寄せの加速度 (blocks/tick^2) */
  attractAccel: number;
  /** 引き寄せの最高速度上限 (blocks/tick) */
  attractMaxSpeed: number;
  /** 至近距離減衰の開始半径 (blocks) */
  attractNearRadius: number;
  /** 至近距離（2m以内）での引き寄せ倍率 */
  attractNearScale: number;
  /** ゼロ速度インパルス固定を開始する半径 (blocks) */
  attractStickRadius: number;
  /** 引き寄せ開始時の無重力化率 (0.35 = 35%) */
  attractGravityCancelStart: number;
  /** 無重力化率が 100% に到達するまでの時間 (ticks) */
  attractGravityCancelRampTicks: number;
  /** 反発開始時の爆発初速 (blocks/tick) */
  repelBurstSpeed: number;
  /** 反発長押し中に放出し続ける持続反発加速度 (blocks/tick^2) */
  repelSustainAccel: number;
  /** 反発の距離減衰基準距離 r0 (blocks) */
  repelRefDistance: number;
  /** 反発初回バーストのクールタイム (ticks) */
  repelBurstCooldownTicks: number;
  /** 反発初回バースト後に持続反発が開始するまでの遅延 (ticks) */
  repelSustainDelayTicks: number;
  /** 反発初回バースト時に低速落下(1tick)を付与する最小上向きインパルス */
  repelSlowFallMinImpulseY: number;
}

export interface MagnetContactAxis {
  /** 接触想定面に対して垂直な単位軸ベクトル (±X / ±Y / ±Z) */
  dir: Vector3;
  /** プレイヤー胸位置からその軸方向の当たり判定表面までの距離 (blocks) */
  surfaceDist: number;
}

export interface MagnetHookshotState
  extends BaseHookshotState<typeof MAGNET_HOOKSHOT_ID> {
  /** 磁化されているブロックの整数座標 */
  blockPos: Vector3;
  /** 現在発動中の磁力モード ("none" / "attract"=Shift / "repel"=Jump) */
  activeMode: MagnetForceMode;
  /** 今Tickがモード開始瞬間（初速／爆発バースト適用Tick）かどうか */
  isModeEntryTick?: boolean;
  /** 一度以上引き寄せまたは反発を実行したかどうか（地上・無入力での自動解除条件） */
  canAutoDetachOnGround?: boolean;
  /** ゼロ速度インパルス固定で吸着中かどうか */
  isStuck?: boolean;
  /** 吸着固定時のスナップ座標（ジッター補正用） */
  stuckLocation?: Vector3;
  /** 動作音再生の直近Tick */
  lastActiveSoundTick?: number;
  /** 反発初回バーストの直近発動Tick */
  lastRepelBurstTick?: number;
  /** 引き寄せ入力の連続保持Tick数（無重力ランプアップ用） */
  attractHoldTicks?: number;
  /** 反発入力の連続保持Tick数 */
  repelHoldTicks?: number;
}

export interface MagnetHookshotDefinition
  extends BaseHookshotDefinition<
    typeof MAGNET_HOOKSHOT_ID,
    MagnetHookshotState
  > {
  /** 着弾（磁化成功）時の効果音ID */
  hitSoundId: string;
  /** 不発（空撃ち）時の効果音ID */
  missSoundId: string;
  /** 解除時の効果音ID */
  detachSoundId: string;
  /** 磁力稼働中のループ効果音設定 */
  activeSound: {
    soundId: string;
    intervalTicks: number;
  };
  /** 物理パラメータ */
  physics: MagnetPhysicsConfig;
}

export type MagnetSoundPlayer = (
  player: Player,
  soundId: string,
  pitch?: number,
) => void;
