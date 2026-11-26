import { Vector3 } from "@minecraft/server";
import { RigidSteeringConfig } from "../math/steering-math";
import { RigidPhysicsConfig } from "../rigid/type";
import { BaseHookshotDefinition, BaseHookshotState } from "../types";

export const ZIPLINE_HOOKSHOT_ID = "zipline";

export interface ZiplineRailPhysicsConfig {
  /** 入力（Jump / Shift）によるレール上の加速度 (blocks/tick²) */
  inputAccel: number;
  /** レール斜度に対する重力加速度係数 (blocks/tick²) */
  railGravity: number;
  /** 通常走行時の速度減衰（摩擦）係数 (per tick) */
  friction: number;
  /** 同時押し（ブレーキ）時の速度減衰係数 (per tick) */
  brakeFriction: number;
  /** レール上の最大移動速度 (blocks/tick) */
  maxRailSpeed: number;
  /** プレイヤー胴からアンカーまでの最大許容距離 (blocks, 鎖4.0m + 許容2.0m = 6.0m) */
  maxAnchorDistance: number;
  /** 地面踏ん張り判定で鎖が張ったとみなす胴〜アンカー距離 (blocks, デフォルト: 3.9) */
  tautChainLength: number;
  /** プレイヤー足元から胴接続点までのYオフセット (blocks) */
  torsoHeightOffset: number;
  /** 最小停止速度閾値 (blocks/tick) */
  stopSpeedThreshold: number;
}

export interface ZiplineRailStepInput {
  railStart: Vector3;
  railEnd: Vector3;
  railLength: number;
  railProgress: number;
  railVelocity: number;
  dimensionId: string;
  jumpPressed: boolean;
  sneakPressed: boolean;
  /** 視線に基づく正面進行符号 (+1: 終点方向, -1: 始点方向) */
  inputDirectionSign: 1 | -1;
  isOnGround: boolean;
  playerLocation: Vector3;
  config: ZiplineRailPhysicsConfig;
}

export interface ZiplineRailStepResult {
  railProgress: number;
  railVelocity: number;
  anchor: Vector3 & { dimensionId: string };
}

export interface ZiplineHookshotOptions {
  baumgarteFactor: number;
  physics: RigidPhysicsConfig;
  steering: RigidSteeringConfig;
  swingPumpAccel: number;
  /** レール方向（始点→終点）の単位ベクトル */
  railDir: Vector3;
  /** アンカーの現在速度ベクトル (blocks/tick) */
  anchorVelocity: Vector3;
  /** レール平行方向（前後揺れ）のダンピング率 (0.0〜1.0, デフォルト: 0.14) */
  parallelDamping?: number;
  /** レール垂直方向（左右スイング）のダンピング率 (0.0〜1.0, デフォルト: 0.02) */
  lateralDamping?: number;
  /** true のときレールと平行なスイング加速成分を無効化する */
  suppressParallelSwing?: boolean;
}


export interface ZiplineHookshotState
  extends BaseHookshotState<typeof ZIPLINE_HOOKSHOT_ID> {
  /** 支柱の地面側ベース座標 */
  railBase: Vector3;
  /** 終点側支柱の地面側／壁面側ベース座標 */
  endRailBase?: Vector3;
  /** 終点側支柱の先端座標（省略時は railEnd を使用） */
  endRailTop?: Vector3;
  /** レールの始点（支柱頂点）座標 */
  railStart: Vector3;
  /** レールの終点（着弾オフセット後または終点支柱頂点）座標 */
  railEnd: Vector3;
  /** 始点側を支えているブロック座標 */
  startSupportBlock: Vector3;
  /** 終点側を支えているブロック座標 */
  endSupportBlock: Vector3;
  /** レールの全長 (blocks) */
  railLength: number;
  /** 始点からの現在進行距離 (0 〜 railLength, blocks) */
  railProgress: number;
  /** レール上の現在速度 (blocks/tick, 正=終点方向, 負=始点方向) */
  railVelocity: number;
  /** 視線に基づく現在の正面進行符号 (+1: 終点方向, -1: 始点方向) */
  facingDirectionSign?: 1 | -1;
  /** 滑走効果音の直近再生Tick */
  lastSlideSoundTick?: number;
  /** 緩やか降下条件を連続で満たしているTick数 */
  gentleDescentTicks?: number;
  /** 直近で1tick低速落下を付与したTick */
  lastSlowFallTick?: number;
}

export interface ZiplineHookshotDefinition
  extends BaseHookshotDefinition<
    typeof ZIPLINE_HOOKSHOT_ID,
    ZiplineHookshotState
  > {
  /** 足元4点レイキャストによる発射判定・支柱設定 */
  groundCheck: {
    /** 足元中心からのXZオフセット幅 (blocks) */
    halfWidth: number;
    /** 下向きレイキャストの最大距離 (blocks) */
    maxDownDistance: number;
    /** 支柱の高さ (blocks) */
    pillarHeight: number;
    /** 天井ブロックとの最小クリアランス (blocks) */
    ceilingClearance: number;
    /** 着弾面の法線方向への手前オフセット量 (blocks) */
    endNormalOffset: number;
    /** 生成可能な最小レール長 (blocks) */
    minRailLength: number;
  };
  /** 吊り下げ鎖の基準長（足元基準, blocks） */
  hangingRopeLength: number;
  /** 無入力（Jump/Shift未押下）時に鎖へ加えるたるみ余裕 (blocks) */
  idleSlackOffset: number;
  /** 入力（Jump/Shift押下）時に鎖を詰める短縮量 (blocks) */
  activePullOffset: number;
  /** 描画上の鎖長（胴基準, blocks） */
  visualChainLength: number;
  /** 着弾・解除・不発・滑走音設定 */
  hitSoundId: string;
  missSoundId: string;
  detachSoundId: string;
  slideSound: {
    soundId: string;
    intervalTicks: number;
    minSpeed: number;
  };
  /** 緩やかな降下時の累積落下ダメージ防止設定 */
  fallProtection: {
    /** 許容するアンカーY速度の下限 (blocks/tick) */
    minAnchorVelY: number;
    /** 許容するプレイヤーY速度の下限 (blocks/tick) */
    minPlayerVelY: number;
    /** 付与に必要な連続条件達成Tick数 */
    requiredConsecutiveTicks: number;
    /** 低速落下再付与までのクールタイム (ticks) */
    cooldownTicks: number;
  };
  /** レール上の1次元アンカー移動物理パラメータ */
  railPhysics: ZiplineRailPhysicsConfig;
  /** 吊り下げ剛体ロープの物理パラメータ */
  physics: RigidPhysicsConfig;
  /** 振り子ポンプ用の最小ステアリングパラメータ */
  steering: RigidSteeringConfig;
}