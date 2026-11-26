import { Vector3Utils } from "@minecraft/math";
import { Player, Vector3 } from "@minecraft/server";
import {
  calculateVelocityImpulse,
  MINECRAFT_DRAG,
  MINECRAFT_GRAVITY,
} from "addon-utils";
import { EPSILON, PLAYER_CHEST_HEIGHT_OFFSET } from "../constants";
import { getDirectionAndDistance, predictTickPhysics } from "./physics-utils";

export type MagnetForceMode = "none" | "attract" | "repel";

export interface MagnetPhysicsConfig {
  /** 最大効果ゾーンの上限距離 (blocks, 50m) */
  fullEffectDistance: number;
  /** 減衰ゾーンの上限距離 / 効果0になる距離 (blocks, 80m) */
  zeroEffectDistance: number;
  /** 引き寄せ開始時の初速 (blocks/tick, 0.8倍 = 1.6) */
  attractInitialSpeed: number;
  /** 引き寄せの加速度 (blocks/tick^2) */
  attractAccel: number;
  /** 引き寄せの最高速度上限 (blocks/tick, 2倍 = 4.0) */
  attractMaxSpeed: number;
  /** 至近距離減衰の開始半径 (blocks, 2.0m) */
  attractNearRadius: number;
  /** 至近距離（2m以内）での引き寄せ倍率 (1/3) */
  attractNearScale: number;
  /** 座標ピン留め吸着を開始する半径 (blocks, 1.6m) */
  attractStickRadius: number;
  /** 反発開始時の爆発初速 (blocks/tick) */
  repelBurstSpeed: number;
  /** 反発長押し中に放出し続ける持続反発加速度 (blocks/tick^2) */
  repelSustainAccel: number;
  /** 反発の逆二乗減衰の基準最小距離 r0 (blocks) */
  repelRefDistance: number;
  /** 反発初回バーストのクールタイム (ticks) */
  repelBurstCooldownTicks: number;
  /** 反発初回バースト時に低速落下(1tick)を付与する最小上向きインパルス */
  repelSlowFallMinImpulseY: number;
}

/**
 * 距離 r に応じた効果倍率 effectRatio(r) を返します。
 * - 0 〜 50m: 1.0
 * - 50 〜 80m: 1.0 → 0.0 へ滑らかに減衰 (smoothstep)
 * - 80m 以上: 0.0
 */
export function calculateMagnetEffectRatio(
  distance: number,
  config: MagnetPhysicsConfig,
): number {
  if (distance <= config.fullEffectDistance) {
    return 1.0;
  }
  if (distance >= config.zeroEffectDistance) {
    return 0.0;
  }
  const span = Math.max(
    config.zeroEffectDistance - config.fullEffectDistance,
    EPSILON,
  );
  const t = (distance - config.fullEffectDistance) / span;
  return 1 - t * t * (3 - 2 * t);
}

/**
 * 距離ゾーン effectRatio(r) に基づき、
 * - attract: 初速 1.6 b/t から加速度 0.20 b/t² で最大 4.0 b/t まで加速＋吸着ロック
 * - repel: 開始時に爆発初速 3.2 b/t を与えつつ、持続的な反発力 0.12 b/t² を放出
 * のインパルスを計算します。
 */
export function calculateMagnetHookshot(
  player: Player,
  anchor: Vector3,
  mode: MagnetForceMode,
  isEntryTick: boolean,
  config: MagnetPhysicsConfig,
): Vector3 {
  if (mode === "none") {
    return { x: 0, y: 0, z: 0 };
  }

  const chestPos: Vector3 = {
    x: player.location.x,
    y: player.location.y + PLAYER_CHEST_HEIGHT_OFFSET,
    z: player.location.z,
  };

  const { dir, distance } = getDirectionAndDistance(chestPos, anchor);
  const effectRatio = calculateMagnetEffectRatio(distance, config);
  if (effectRatio <= EPSILON) {
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

  let targetVel: Vector3;

  if (mode === "attract") {
    const nearScale =
      distance <= config.attractNearRadius ? config.attractNearScale : 1.0;
    const initialSpeed = config.attractInitialSpeed * nearScale;
    const accel = config.attractAccel * nearScale;
    const maxSpeed = config.attractMaxSpeed * nearScale;

    let desiredVel: Vector3;
    if (isEntryTick) {
      // 開始瞬間: 初速（1.6 b/t, 2m以内は1/3）で発進
      desiredVel = Vector3Utils.scale(dir, initialSpeed);
    } else {
      // 2 Tick目以降: 加速度で上限（4.0 b/t, 2m以内は1/3）まで連続的に引き寄せ続ける
      const curDirSpeed = Math.max(0, Vector3Utils.dot(currentVel, dir));
      const nextSpeed = Math.min(
        maxSpeed,
        Math.max(curDirSpeed, initialSpeed) + accel,
      );
      desiredVel = Vector3Utils.scale(dir, nextSpeed);
    }
    targetVel = Vector3Utils.lerp(predictedVel, desiredVel, effectRatio);
  } else {
    const outDir =
      distance >= EPSILON ? Vector3Utils.scale(dir, -1) : { x: 0, y: 1, z: 0 };
    const clampedR = Math.max(distance, Math.max(config.repelRefDistance, EPSILON));
    const inverseDistScale = config.repelRefDistance / clampedR;

    if (isEntryTick) {
      // 開始瞬間: 距離に反比例した爆発初速で弾き出す
      const burstFactor = inverseDistScale * effectRatio;
      targetVel = Vector3Utils.add(
        predictedVel,
        Vector3Utils.scale(outDir, config.repelBurstSpeed * burstFactor),
      );
    } else {
      // 持続: 距離の二乗に反比例した反発力を放出しつつ空気抵抗・重力で減衰させる
      const sustainFactor = inverseDistScale * inverseDistScale * effectRatio;
      targetVel = Vector3Utils.add(
        predictedVel,
        Vector3Utils.scale(outDir, config.repelSustainAccel * sustainFactor),
      );
    }
  }

  return calculateVelocityImpulse({
    targetVelocity: targetVel,
    currentVelocity: currentVel,
    dragXZ,
    dragY,
    gravity: MINECRAFT_GRAVITY,
  });
}
