import {
  BaseHookshotDefinition,
  BaseHookshotState,
  ChargeMilestoneSoundConfig,
  ContinuousReelState,
  RaycastGraceCapable,
  ReelCapable,
} from "../types";

export const ELASTIC_HOOKSHOT_ID = "elastic";

export interface ElasticInputChargeControlConfig {
  /** 前後移動入力によるチャージ/巻き取り配分を有効にするかどうか */
  enabled: boolean;
  /** 前入力 (W) 時のチャージバネ定数加算ゲイン（通常時） */
  forwardGainNormal: number;
  /** 前入力 (W) 時のチャージバネ定数加算ゲイン（エアロベスト強化時） */
  forwardGainBoosted: number;
  /** 後入力 (S) 時のチャージバネ定数最小倍率（通常時） */
  backwardMinMultiplierNormal: number;
  /** 後入力 (S) 時のチャージバネ定数最小倍率（エアロベスト強化時） */
  backwardMinMultiplierBoosted: number;
}

export interface ElasticPhysicsConfig {
  /** 限界長の下限値 (blocks) */
  minConstraintLength: number;
  /** 現在長に対する限界長倍率 */
  constraintLengthMultiplier: number;
  /** バネ定数（通常ぶら下がり時の固定値オーバーライド用） */
  stiffness?: number;
  /** 通常ぶら下がり時の弾性係数 (ヤング率相当: 実効バネ定数 = hangElasticity / clampedLength) */
  hangElasticity: number;
  /** 通常ぶら下がり時のヤング率分母の下限 (blocks) */
  minHangDenominator: number;
  /** 通常ぶら下がり時のヤング率分母の上限 (blocks) */
  maxHangDenominator: number;
  /** チャージ中（isReelingIn=true）の基本バネ定数。小さいほど移動せず張力が溜まりやすい */
  chargeStiffness: number;
  /** 解放時（isReelingIn=false）のフォールバック用バネ定数 */
  releaseStiffness?: number;
  /** 解放時の法線方向減衰率 (0〜1) */
  damping: number;
  /** チャージ中の法線方向減衰率 (0〜1)。巻き取り速度との収束点を決める */
  chargeDamping: number;
  /** 1Tickあたりの最大引き込み加速度 (blocks/tick²)。急な伸びでの暴発防止 */
  maxAcceleration: number;
  /** 前後入力によるチャージ/巻き取り配分設定 */
  inputChargeControl: ElasticInputChargeControlConfig;
}

export interface ElasticReleaseConfig {
  /** 巻き取り終了（チャージ解放）時の効果音ID */
  soundId: string;
  /** 発射を有効とする最小の伸び量 (blocks) */
  minStretch: number;
  /** 最高速度に到達する基準伸び量 (blocks) */
  referenceStretch: number;
  /** 最小有効伸び量時の初速 (blocks/tick) */
  minLaunchSpeed: number;
  /** 解放時の最高初速上限 (blocks/tick) */
  maxLaunchSpeed: number;
  /** 伸び量に応じた初速カーブのべき乗指数 */
  launchSpeedExponent: number;
  /** エアロベスト装備時に射出計算へ適用する実効チャージ倍率 */
  boostedStretchMultiplier?: number;
  /** 射出方向への上向きバイアス (Y成分加算量、山なり軌道用) */
  upwardBias: number;
  /** 放物線射出中の失速判定を開始するまでの最低飛行猶予Tick数 */
  minFlightTicks: number;
  /** 放物線射出中に失速とみなすアンカー接近速度の閾値 (blocks/tick) */
  stallApproachSpeed: number;
  /** 連続失速とみなして放物線モードを終了するTick数 */
  maxStallTicks: number;
  /** 放物線射出モードの最大持続Tick数 */
  maxReleaseTicks: number;
}

export interface ElasticRopeParams
  extends Omit<
    ElasticPhysicsConfig,
    "minConstraintLength" | "constraintLengthMultiplier" | "inputChargeControl"
  > {
  /** ロープの自然長。これ以下ではたるんで力が働かない */
  naturalLength: number;
  /** 最小ロープ長到達後に追加で蓄積された仮想チャージ量 */
  extraCharge?: number;
  /** ロープの限界長。これを超えると硬い拘束に切り替わる */
  maxLength?: number;
  /** Baumgarte 位置誤差安定化係数 */
  baumgarteFactor: number;
  /** 空中ジャンプ入力によって現在チャージ（巻き取り）中かどうか */
  isReelingIn?: boolean;
  /** チャージ解放による放物線射出モード中かどうか */
  isChargeReleasing?: boolean;
  /** リリース直後の初速インパルスを適用するTickかどうか */
  releaseShotPending?: boolean;
  /** 前後入力によるチャージ/巻き取り配分設定 */
  inputChargeControl: ElasticInputChargeControlConfig;
  /** エアロベスト装備等によって前後入力の調整幅を強化するかどうか */
  boostInputChargeControl?: boolean;
  /** リリース射出パラメータ */
  release: ElasticReleaseConfig;
}

/**
 * 伸縮ロープフックの空中連続発動（発射後〜着地まで）追跡状態
 */
export interface ElasticAirChainState {
  /** 射出後に一度でも空中（非接地）に出たかどうか */
  hasBeenAirborne: boolean;
  /** 射出された Tick */
  launchTick: number;
}


export interface ElasticHookshotState
  extends BaseHookshotState<typeof ELASTIC_HOOKSHOT_ID>,
    ContinuousReelState {
  /** 最小ロープ長到達後に蓄積された追加チャージ量 (blocks) */
  extraCharge?: number;
  /** チャージ解放による放物線射出モード中かどうか */
  isChargeReleasing?: boolean;
  /** リリース直後の初速インパルスを未適用かどうか */
  releaseShotPending?: boolean;
  /** リリース開始Tick */
  releaseStartTick?: number;
  /** 放物線射出中の前Tickにおけるアンカーとの距離 */
  lastReleaseDistance?: number;
  /** 放物線射出中に接近速度が閾値を下回った連続Tick数 */
  releaseStallTicks?: number;
  /** 前Tickのチャージ伸び量（マイルストーン効果音判定用） */
  prevChargeStretch?: number;
  /** 直近に鳴らしたチャージマイルストーン距離 (m) */
  lastChargeSoundThreshold?: number;
  /** 直近のマイルストーンから±hysteresis以上離れて再鳴動可能になったか */
  canRetriggerLastThreshold?: boolean;
}

export interface ElasticDistanceReelSpeedConfig {
  /** 加速が開始されるアンカー距離の下限 (blocks) */
  minDistance: number;
  /** 最大巻き取り速度に到達するアンカー距離の上限 (blocks) */
  maxDistance: number;
  /** 遠距離到達時の最大巻き取り速度 (blocks/tick) */
  maxSpeed: number;
}

export interface ElasticChargeSpeedBoostConfig {
  /** 空中チェイン時の近距離側（minDistance以下）の巻き取り速度 (blocks/tick) */
  airChainMinSpeed: number;
  /** 空中チェイン時の遠距離側（maxDistance以上）の巻き取り速度 (blocks/tick) */
  airChainMaxSpeed: number;
}

export interface ElasticHookshotDefinition
  extends BaseHookshotDefinition<
      typeof ELASTIC_HOOKSHOT_ID,
      ElasticHookshotState
    >,
    ReelCapable,
    RaycastGraceCapable {
  /** 最小ロープ長到達後に追加で蓄積できる仮想チャージ上限 (blocks, 未指定時は無制限) */
  maxExtraCharge?: number;
  /** 自然長との差（stretch）がこの距離 (blocks) を超えるとゴムが切れて自動解除される */
  maxOverstretchDistance: number;
  /** 伸び切り破断時の効果音ID */
  overstretchSoundId: string;
  /** アンカーとの距離に応じた巻き取り速度ブースト設定 */
  distanceReelSpeed: ElasticDistanceReelSpeedConfig;
  /** 空中チェイン・エアロベスト後ろ入力によるチャージ速度バフ設定 */
  chargeSpeedBoost: ElasticChargeSpeedBoostConfig;
  /** 伸縮ゴム紐の弾性・チャージ物理パラメータ */
  physics: ElasticPhysicsConfig;
  /** チャージ解放（パチンコ射出）パラメータ */
  release: ElasticReleaseConfig;
  /** チャージ中の伸び量マイルストーン効果音設定 */
  chargeMilestoneSound: ChargeMilestoneSoundConfig;
}