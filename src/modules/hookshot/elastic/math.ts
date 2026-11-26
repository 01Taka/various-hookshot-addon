import { Vector3Utils } from "@minecraft/math";
import { Player, Vector3 } from "@minecraft/server";
import { MINECRAFT_GRAVITY, PlayerDirectionResolver } from "addon-utils";
import {
  AIR_DRAG_BASE,
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
} from "../math/physics-utils";
import {
  ElasticInputChargeControlConfig,
  ElasticPhysicsConfig,
  ElasticReleaseConfig,
  ElasticRopeParams,
} from "./type";

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
    baumgarteFactor,
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
    const stretchSpan = Math.max(
      EPSILON,
      release.referenceStretch - release.minStretch,
    );
    const effectiveStretch =
      boostInputChargeControl && release.boostedStretchMultiplier
        ? stretch * release.boostedStretchMultiplier
        : stretch;
    const t = Math.min(
      1,
      Math.max(0, (effectiveStretch - release.minStretch) / stretchSpan),
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
        -penetration * baumgarteFactor,
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
