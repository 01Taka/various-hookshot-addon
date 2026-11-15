import { Vector3Utils } from "@minecraft/math";
import { Player, Vector3 } from "@minecraft/server";
import { MINECRAFT_GRAVITY, PlayerDirectionResolver } from "addon-utils";
import {
  AIR_DRAG_BASE,
  BAUMGARTE_FACTOR,
  EPSILON,
  INPUT_DEADZONE,
} from "../constants";
import {
  clampOutwardVelocity,
  convertTargetVelocityToImpulse,
  getAirDrag,
  getDirectionAndDistance,
  getNormalComponent,
  predictTickPhysics,
} from "./physics-utils";

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
  maxLengthMin: number;
  /** 現在長に対する限界長倍率 */
  maxLengthMultiplier: number;
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
  refStretch: number;
  /** 最小有効伸び量時の初速 (blocks/tick) */
  minLaunchSpeed: number;
  /** 解放時の最高初速上限 (blocks/tick) */
  maxLaunchSpeed: number;
  /** 伸び量に応じた初速カーブのべき乗指数 */
  launchSpeedExponent: number;
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
    "maxLengthMin" | "maxLengthMultiplier" | "inputChargeControl"
  > {
  /** ロープの自然長。これ以下ではたるんで力が働かない */
  naturalLength: number;
  /** 最小ロープ長到達後に追加で蓄積された仮想チャージ量 */
  extraCharge?: number;
  /** ロープの限界長。これを超えると硬い拘束に切り替わる */
  maxLength?: number;
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
 * 前後入力（W/S）に応じたチャージ中バネ定数の倍率を計算します。
 */
function getChargeStiffnessMultiplier(
  player: Player,
  control: ElasticInputChargeControlConfig,
  isBoosted?: boolean,
): number {
  const inputZ = PlayerDirectionResolver.get(player).input.vector.z;
  if (inputZ > INPUT_DEADZONE) {
    const forwardGain = isBoosted
      ? control.forwardGainBoosted
      : control.forwardGainNormal;
    return 1.0 + Math.min(1.0, inputZ) * forwardGain;
  }
  if (inputZ < -INPUT_DEADZONE) {
    const minMultiplier = isBoosted
      ? control.backwardMinMultiplierBoosted
      : control.backwardMinMultiplierNormal;
    const backwardGain = 1.0 - minMultiplier;
    return Math.max(minMultiplier, 1.0 + Math.max(-1.0, inputZ) * backwardGain);
  }
  return 1.0;
}

export function calculateElasticVelocity(
  player: Player,
  anchor: Vector3,
  {
    naturalLength,
    extraCharge = 0,
    maxLength,
    stiffness,
    hangElasticity,
    minHangDenominator,
    maxHangDenominator,
    chargeStiffness,
    releaseStiffness,
    damping,
    chargeDamping,
    maxAcceleration,
    isReelingIn,
    isChargeReleasing,
    releaseShotPending,
    inputChargeControl,
    boostInputChargeControl,
    release,
  }: ElasticRopeParams,
): Vector3 | null {
  const { dir: normal, distance: r } = getDirectionAndDistance(
    anchor,
    player.location,
  );
  if (r < EPSILON) return null;

  const effectiveNaturalLength = naturalLength - extraCharge;

  // たるみ中は自由運動（テンション発生時のみ作動）
  if (r <= effectiveNaturalLength) return null;

  const currentVel = player.getVelocity();
  const speed = Vector3Utils.magnitude(currentVel);
  const isCharging = !!isReelingIn;
  const isLaunching = !isCharging && !!isChargeReleasing;
  const stretch = r - effectiveNaturalLength;

  // --- 1. リリース直後の1Tick目: 一撃のパチンコ初速（アンカー方向＋上向きバイアス）を射出 ---
  if (isLaunching && releaseShotPending) {
    const toAnchor = Vector3Utils.scale(normal, -1);
    const biasedDir = {
      x: toAnchor.x,
      y: toAnchor.y + release.upwardBias,
      z: toAnchor.z,
    };
    const launchDir = Vector3Utils.normalize(biasedDir);
    const stretchSpan = Math.max(EPSILON, release.refStretch - release.minStretch);
    const t = Math.min(
      1,
      Math.max(0, (stretch - release.minStretch) / stretchSpan),
    );
    const launchSpeed =
      release.minLaunchSpeed +
      (release.maxLaunchSpeed - release.minLaunchSpeed) *
        Math.pow(t, release.launchSpeedExponent);
    return Vector3Utils.scale(launchDir, launchSpeed);
  }

  // --- 2. 放物線飛行中: 引き寄せを止め、空気抵抗＋重力のみの自由放物線 ---
  if (isLaunching) {
    return predictTickPhysics({
      velocity: currentVel,
      dragXZ: AIR_DRAG_BASE,
    });
  }

  // --- 3. チャージ中 / 通常ぶら下がり中: ゴムの復元力計算 ---
  const vPred = predictTickPhysics({
    velocity: currentVel,
    dragXZ: getAirDrag(speed),
  });

  let activeStiffness: number;
  if (isCharging) {
    activeStiffness = chargeStiffness;
    if (inputChargeControl.enabled) {
      activeStiffness *= getChargeStiffnessMultiplier(
        player,
        inputChargeControl,
        boostInputChargeControl,
      );
    }
  } else if (stiffness !== undefined || releaseStiffness !== undefined) {
    activeStiffness = stiffness ?? releaseStiffness!;
  } else {
    const denominator = Math.min(
      maxHangDenominator,
      Math.max(minHangDenominator, naturalLength),
    );
    activeStiffness = hangElasticity / denominator;
  }
  const activeDamping = isCharging ? chargeDamping : damping;

  // ゴムの復元力（フックの法則）＋ チャージ中は角度に応じた重力支え分を加算して落下を防ぐ
  const gravitySupport = isCharging
    ? Math.max(0, -normal.y * MINECRAFT_GRAVITY)
    : 0;
  const springAccel = Math.min(
    activeStiffness * stretch + gravitySupport,
    maxAcceleration,
  );

  // 法線方向の速度に比例した減衰（外向き・内向きどちらにも効かせる）
  const vn = getNormalComponent(vPred, normal);
  const dampingAccel = vn * activeDamping;

  // 内向き(-normal)に加速度を加えた目標速度
  let target = Vector3Utils.subtract(
    vPred,
    Vector3Utils.scale(normal, springAccel + dampingAccel),
  );

  // 限界長を超えたら硬い拘束
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

export function calculateElasticHookshot(
  player: Player,
  anchor: Vector3,
  params: ElasticRopeParams,
): Vector3 {
  const velocity = calculateElasticVelocity(player, anchor, params);
  return convertTargetVelocityToImpulse(player, velocity);
}
