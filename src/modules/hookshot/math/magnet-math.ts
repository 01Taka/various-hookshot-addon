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
  /** 引き寄せ時の吸着ロック半径 (blocks, 1.5〜2.0m) */
  attractLockRadius: number;
  /** 反発開始時の爆発初速 (blocks/tick) */
  repelBurstSpeed: number;
  /** 反発長押し中に放出し続ける持続反発加速度 (blocks/tick^2) */
  repelSustainAccel: number;
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
    let desiredVel: Vector3;
    if (distance <= config.attractLockRadius) {
      // 至近距離（1.8m以内）: 強い減衰で通り過ぎずに壁・天井へピタッと吸着・静止
      const pullSpeed = distance > 0.3 ? Math.min(distance * 0.15, 0.2) : 0;
      const lockVel =
        distance >= EPSILON
          ? Vector3Utils.scale(dir, pullSpeed)
          : { x: 0, y: 0, z: 0 };
      desiredVel = Vector3Utils.add(
        Vector3Utils.scale(currentVel, 0.15),
        Vector3Utils.scale(lockVel, 0.85),
      );
    } else if (isEntryTick) {
      // 開始瞬間: 初速（現在の0.8倍 = 1.6 b/t）で発進
      desiredVel = Vector3Utils.scale(dir, config.attractInitialSpeed);
    } else {
      // 2 Tick目以降: 加速度で上限（現在の2倍 = 4.0 b/t）まで加速
      const curDirSpeed = Math.max(0, Vector3Utils.dot(currentVel, dir));
      const nextSpeed = Math.min(
        config.attractMaxSpeed,
        Math.max(curDirSpeed, config.attractInitialSpeed) +
          config.attractAccel,
      );
      desiredVel = Vector3Utils.scale(dir, nextSpeed);
    }
    targetVel = Vector3Utils.lerp(predictedVel, desiredVel, effectRatio);
  } else {
    const outDir =
      distance >= EPSILON ? Vector3Utils.scale(dir, -1) : { x: 0, y: 1, z: 0 };
    if (isEntryTick) {
      // 開始瞬間: 爆発初速で弾き出す
      const burstVel = Vector3Utils.scale(outDir, config.repelBurstSpeed);
      targetVel = Vector3Utils.lerp(predictedVel, burstVel, effectRatio);
    } else {
      // 持続: 常に反発力を放出しつつ空気抵抗・重力で減衰させる
      targetVel = Vector3Utils.add(
        predictedVel,
        Vector3Utils.scale(outDir, config.repelSustainAccel * effectRatio),
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
