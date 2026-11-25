import { Vector3Utils } from "@minecraft/math";
import { Player, Vector3 } from "@minecraft/server";
import {
  calculateVelocityImpulse,
  MINECRAFT_DRAG,
  MINECRAFT_GRAVITY,
} from "addon-utils";
import { EPSILON, PLAYER_CHEST_HEIGHT_OFFSET } from "../constants";
import { getDirectionAndDistance, predictTickPhysics } from "./physics-utils";

export type MagnetPolarity = "attract" | "repel";
export type MagnetInputMode = "none" | "normal" | "inverted";

export interface MagnetNode {
  /** 磁化対象ブロックの整数座標 */
  blockPos: Vector3;
  /** 磁化対象ブロックの中心座標 */
  center: Vector3;
  /** 配置されたディメンションID */
  dimensionId: string;
  /** 磁石の初期極性 ("attract": 吸着 / "repel": 反発) */
  polarity: MagnetPolarity;
  /** 金属・磁性体ブロックによるボーナス対象かどうか */
  isMetallic: boolean;
  /** 磁力倍率 (通常: 1.0, 金属: 1.4) */
  multiplier: number;
}

export interface MagnetPhysicsConfig {
  /** 1個あたりの基本加速度 (blocks/tick^2) */
  baseAccel: number;
  /** 初回起動ブースト時の加速度倍率 */
  initialBoostMultiplier: number;
  /** 地上から初回ブースト発動時に付与する最小上向きリフト (blocks/tick) */
  initialBoostGroundLiftY: number;
  /** 距離減衰の基準最小距離 r0 (blocks) */
  r0: number;
  /** 距離減衰の指数 p (2.0 = 距離の二乗に反比例) */
  decayExponent: number;
  /** 合計加速度の上限 (blocks/tick^2) */
  maxTotalAccel: number;
  /** 1個配置時の最高速度上限 (blocks/tick) */
  maxSpeedSingle: number;
  /** 2個配置時の最高速度上限 (blocks/tick) */
  maxSpeedDouble: number;
  /** 3個配置時の最高速度上限 (blocks/tick) */
  maxSpeedTriple: number;
  /** 初回起動までの連続入力必要Tick数 (5〜6 ticks = 0.25〜0.3秒) */
  startupDelayTicks: number;
  /** 金属・磁性体ブロックの磁力倍率 */
  metallicMultiplier: number;
}

/**
 * 磁石の極性と現在の入力モード（通常=Jump / 反転=Shift）から実効符号（+1: 吸着, -1: 反発）を返します。
 */
export function getEffectiveMagnetSign(
  polarity: MagnetPolarity,
  mode: MagnetInputMode,
): 1 | -1 | 0 {
  if (mode === "none") return 0;
  const baseSign = polarity === "attract" ? 1 : -1;
  return mode === "normal" ? baseSign : (-baseSign as 1 | -1);
}

/**
 * 距離減衰スケールを計算します: (r0 / max(r, r0))^p
 */
export function calculateMagnetDistanceScale(
  distance: number,
  r0: number,
  decayExponent: number,
): number {
  const clampedR = Math.max(distance, Math.max(r0, EPSILON));
  return Math.pow(r0 / clampedR, decayExponent);
}

/**
 * 配置数に応じた最高速度上限を取得します。
 */
export function getMagnetMaxSpeed(
  nodeCount: number,
  config: MagnetPhysicsConfig,
): number {
  if (nodeCount <= 1) return config.maxSpeedSingle;
  if (nodeCount === 2) return config.maxSpeedDouble;
  return config.maxSpeedTriple;
}

/**
 * 配置中の全磁化ブロックからの合力ベクトルを計算し、プレイヤーへのインパルスを返します。
 */
export function calculateMagnetHookshot(
  player: Player,
  nodes: MagnetNode[],
  mode: MagnetInputMode,
  isBoostTick: boolean,
  config: MagnetPhysicsConfig,
): Vector3 {
  if (mode === "none" || nodes.length === 0) {
    return { x: 0, y: 0, z: 0 };
  }

  const chestPos: Vector3 = {
    x: player.location.x,
    y: player.location.y + PLAYER_CHEST_HEIGHT_OFFSET,
    z: player.location.z,
  };

  let sumAccel: Vector3 = { x: 0, y: 0, z: 0 };

  for (const node of nodes) {
    const sign = getEffectiveMagnetSign(node.polarity, mode);
    if (sign === 0) continue;

    const { dir, distance } = getDirectionAndDistance(chestPos, node.center);
    if (distance < EPSILON) continue;

    const distScale = calculateMagnetDistanceScale(
      distance,
      config.r0,
      config.decayExponent,
    );
    const accelMag = config.baseAccel * node.multiplier * distScale * sign;
    sumAccel = Vector3Utils.add(sumAccel, Vector3Utils.scale(dir, accelMag));
  }

  const boostScale = isBoostTick ? config.initialBoostMultiplier : 1.0;
  sumAccel = Vector3Utils.scale(sumAccel, boostScale);

  const maxAccel = config.maxTotalAccel * boostScale;
  const accelMag = Vector3Utils.magnitude(sumAccel);
  if (accelMag > maxAccel && accelMag > EPSILON) {
    sumAccel = Vector3Utils.scale(sumAccel, maxAccel / accelMag);
  }

  if (accelMag < EPSILON && !isBoostTick) {
    return { x: 0, y: 0, z: 0 };
  }

  const currentVel = player.getVelocity();
  const dragY = player.isOnGround
    ? MINECRAFT_DRAG.ground.y
    : MINECRAFT_DRAG.air.y;
  const dragXZ = player.isOnGround
    ? MINECRAFT_DRAG.ground.xz
    : MINECRAFT_DRAG.air.xz;
  const predictedVel = predictTickPhysics({
    velocity: currentVel,
    dragY,
    dragXZ,
  });

  let targetVel = Vector3Utils.add(predictedVel, sumAccel);

  // 地上で初回ブースト発動時は地面摩擦に負けないよう最小上向きリフトを保証
  if (
    isBoostTick &&
    player.isOnGround &&
    targetVel.y < config.initialBoostGroundLiftY
  ) {
    targetVel = {
      ...targetVel,
      y: config.initialBoostGroundLiftY,
    };
  }

  const maxSpeed = getMagnetMaxSpeed(nodes.length, config);
  const targetSpeed = Vector3Utils.magnitude(targetVel);
  if (targetSpeed > maxSpeed && targetSpeed > EPSILON) {
    targetVel = Vector3Utils.scale(targetVel, maxSpeed / targetSpeed);
  }

  return calculateVelocityImpulse({
    targetVelocity: targetVel,
    currentVelocity: currentVel,
    dragXZ,
    dragY,
    gravity: MINECRAFT_GRAVITY,
  });
}
