import { Vector3Utils } from "@minecraft/math";
import { Player, Vector3 } from "@minecraft/server";
import { MINECRAFT_GRAVITY, PlayerDirectionResolver } from "addon-utils";
import {
  clampOutwardVelocity,
  convertTargetVelocityToImpulse,
  getAirDrag,
  getDirectionAndDistance,
  getNormalComponent,
  predictTickPhysics,
} from "./physics-utils";
import { MAX_HOOKSHOT_SPEED } from "./steering-math";

export interface ElasticRopeParams {
  /** ロープの自然長。これ以下ではたるんで力が働かない */
  naturalLength: number;
  /** 最小ロープ長到達後に追加で蓄積された仮想チャージ量 */
  extraCharge?: number;
  /** ロープの限界長。これを超えると硬い拘束に切り替わる */
  maxLength?: number;
  /** バネ定数（通常ぶら下がり時の固定値オーバーライド用） */
  stiffness?: number;
  /** 通常ぶら下がり時の弾性係数 (ヤング率相当: 実効バネ定数 = hangElasticity / clampedLength) */
  hangElasticity?: number;
  /** 通常ぶら下がり時のヤング率分母の下限 (blocks) */
  minHangDenominator?: number;
  /** 通常ぶら下がり時のヤング率分母の上限 (blocks) */
  maxHangDenominator?: number;
  /** チャージ中（isReelingIn=true）の基本バネ定数。小さいほど移動せず張力が溜まりやすい */
  chargeStiffness?: number;
  /** 解放時（isReelingIn=false）のフォールバック用バネ定数 */
  releaseStiffness?: number;
  /** 解放時の法線方向減衰率 (0〜1) */
  damping?: number;
  /** チャージ中の法線方向減衰率 (0〜1)。巻き取り速度との収束点を決める */
  chargeDamping?: number;
  /** 1Tickあたりの最大引き込み加速度 (blocks/tick²)。急な伸びでの暴発防止 */
  maxAcceleration?: number;
  /** 解放時の最高速度上限 (blocks/tick) */
  releaseMaxSpeed?: number;
  /** 空中ジャンプ入力によって現在チャージ（巻き取り）中かどうか */
  isReelingIn?: boolean;
  /** チャージ解放による放物線射出モード中かどうか */
  isChargeReleasing?: boolean;
  /** リリース直後の初速インパルスを適用するTickかどうか */
  releaseShotPending?: boolean;
  /** 射出方向への上向きバイアス (Y成分加算量、山なり軌道用) */
  upwardBias?: number;
  /** 前後移動入力によるチャージ/巻き取り配分を有効にするかどうか */
  enableInputChargeControl?: boolean;
  /** エアロベスト装備等によって前後入力の調整幅を強化するかどうか */
  boostInputChargeControl?: boolean;
}

/**
 * 前後入力（W/S）に応じたチャージ中バネ定数の倍率を計算します。
 * - 前入力 (W, z > 0): 引っ張り力を強めて巻き取り移動を優先（未装備最大 1.5倍 / 強化時最大 2.2倍）
 * - 後入力 (S, z < 0): 引っ張り力を弱めてチャージの蓄積を優先（未装備最小 0.65倍 / 強化時最小 0.3倍）
 */
function getChargeStiffnessMultiplier(
  player: Player,
  isBoosted?: boolean,
): number {
  const inputZ = PlayerDirectionResolver.get(player).input.vector.z;
  if (inputZ > 0.05) {
    const forwardGain = isBoosted ? 1.2 : 0.5;
    return 1.0 + Math.min(1.0, inputZ) * forwardGain;
  }
  if (inputZ < -0.05) {
    const minMultiplier = isBoosted ? 0.3 : 0.65;
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
    hangElasticity = 0.65,
    minHangDenominator = 18.0,
    maxHangDenominator = 120.0,
    chargeStiffness = 0.003,
    releaseStiffness,
    damping = 0.001,
    chargeDamping = 0.085,
    maxAcceleration = 1.35,
    releaseMaxSpeed = 4.0,
    isReelingIn,
    isChargeReleasing,
    releaseShotPending,
    upwardBias = 0.22,
    enableInputChargeControl,
    boostInputChargeControl,
  }: ElasticRopeParams,
): Vector3 | null {
  const { dir: normal, distance: r } = getDirectionAndDistance(
    anchor,
    player.location,
  );
  if (r < 0.0001) return null;

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
      y: toAnchor.y + upwardBias,
      z: toAnchor.z,
    };
    const launchDir = Vector3Utils.normalize(biasedDir);
    // 伸び量に応じた非線形（1.6乗）カーブで初速を決定（5mで1.45、75m以上でreleaseMaxSpeed）
    const minLaunchSpeed = 1.45;
    const minStretch = 5.0;
    const refStretch = 75.0;
    const t = Math.min(
      1,
      Math.max(0, (stretch - minStretch) / (refStretch - minStretch)),
    );
    const launchSpeed =
      minLaunchSpeed + (releaseMaxSpeed - minLaunchSpeed) * Math.pow(t, 1.6);
    return Vector3Utils.scale(launchDir, launchSpeed);
  }

  // --- 2. 放物線飛行中: 引き寄せを止め、0.99 空気抵抗＋重力のみの自由放物線 ---
  if (isLaunching) {
    return predictTickPhysics({
      velocity: currentVel,
      dragXZ: 0.99,
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
    if (enableInputChargeControl) {
      activeStiffness *= getChargeStiffnessMultiplier(
        player,
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
      const BAUMGARTE_FACTOR = 0.15;
      target = clampOutwardVelocity(
        target,
        normal,
        -penetration * BAUMGARTE_FACTOR,
      );
    }
  }

  // 最高速度上限クランプ
  const targetSpeed = Vector3Utils.magnitude(target);
  if (targetSpeed > MAX_HOOKSHOT_SPEED) {
    target = Vector3Utils.scale(target, MAX_HOOKSHOT_SPEED / targetSpeed);
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
