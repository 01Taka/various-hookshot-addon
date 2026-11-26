import { Vector3Utils } from "@minecraft/math";
import { Player, Vector3 } from "@minecraft/server";
import {
  calculateVelocityImpulse,
  MINECRAFT_DRAG,
  MINECRAFT_GRAVITY,
} from "addon-utils";
import { EPSILON, PLAYER_CHEST_HEIGHT_OFFSET } from "../../constants";
import { getDirectionAndDistance, predictTickPhysics } from "../../math/physics-utils";
import { MAGNET_STICK_RESTORE_GAIN } from "./config";
import {
  MagnetContactAxis,
  MagnetForceMode,
  MagnetPhysicsConfig,
} from "./type";

/**
 * 距離 r に応じた効果倍率 effectRatio(r) を返します。
 * - 0 〜 fullEffectDistance (50m): 1.0
 * - fullEffectDistance 〜 zeroEffectDistance (80m): 1.0 → 0.0 へ smoothstep 減衰
 * - zeroEffectDistance 以上: 0.0
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
 * プレイヤー胸位置からアンカー中心への差分から、接触が想定される面の垂直軸方向と表面距離を算出します。
 */
export function resolveMagnetContactAxis(
  chestPos: Vector3,
  anchor: Vector3,
): MagnetContactAxis {
  const toAnchor = Vector3Utils.subtract(anchor, chestPos);
  const ax = Math.abs(toAnchor.x);
  const ay = Math.abs(toAnchor.y);
  const az = Math.abs(toAnchor.z);

  if (ax >= ay && ax >= az) {
    return {
      dir: { x: Math.sign(toAnchor.x) || 1, y: 0, z: 0 },
      surfaceDist: 0.3,
    };
  }
  if (az >= ax && az >= ay) {
    return {
      dir: { x: 0, y: 0, z: Math.sign(toAnchor.z) || 1 },
      surfaceDist: 0.3,
    };
  }
  const signY = Math.sign(toAnchor.y) || 1;
  return {
    dir: { x: 0, y: signY, z: 0 },
    surfaceDist: signY > 0 ? 0.8 : 1.0,
  };
}

/**
 * 吸着固定発動時にプレイヤーを配置するブロック真横のスナップ座標を算出します。
 */
export function calculateMagnetSnapLocation(
  playerLocation: Vector3,
  anchor: Vector3,
  contactDir: Vector3,
): Vector3 {
  return {
    x:
      contactDir.x !== 0
        ? anchor.x - contactDir.x * 0.82
        : playerLocation.x,
    y:
      contactDir.y > 0
        ? anchor.y - 2.32
        : contactDir.y < 0
          ? anchor.y + 0.5
          : playerLocation.y,
    z:
      contactDir.z !== 0
        ? anchor.z - contactDir.z * 0.82
        : playerLocation.z,
  };
}

/**
 * 距離ゾーン effectRatio(r) に基づき、マグネットフックの毎Tickインパルスを計算します。
 * - attract: 2m超は初速→加速の無重力補間、2m以内は1/3スケール、吸着固定中はゼロ速度維持
 * - repel: 初回バースト (1/r) ＋ 5tick後から持続反発 (1/r²)
 */
export function calculateMagnetHookshot(
  player: Player,
  anchor: Vector3,
  mode: MagnetForceMode,
  isEntryTick: boolean,
  isStuck: boolean,
  stuckLocation: Vector3 | undefined,
  attractHoldTicks: number,
  repelHoldTicks: number,
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
    if (isStuck) {
      targetVel = stuckLocation
        ? Vector3Utils.scale(
            Vector3Utils.subtract(stuckLocation, player.location),
            MAGNET_STICK_RESTORE_GAIN,
          )
        : { x: 0, y: 0, z: 0 };
    } else {
      const nearScale =
        distance <= config.attractNearRadius ? config.attractNearScale : 1.0;
      const initialSpeed = config.attractInitialSpeed * nearScale;
      const accel = config.attractAccel * nearScale;
      const maxSpeed = config.attractMaxSpeed * nearScale;

      let desiredVel: Vector3;
      if (isEntryTick) {
        desiredVel = Vector3Utils.scale(dir, initialSpeed);
      } else {
        const curDirSpeed = Math.max(0, Vector3Utils.dot(currentVel, dir));
        const nextSpeed = Math.min(
          maxSpeed,
          Math.max(curDirSpeed, initialSpeed) + accel,
        );
        desiredVel = Vector3Utils.scale(dir, nextSpeed);
      }
      targetVel = Vector3Utils.lerp(predictedVel, desiredVel, effectRatio);

      // 無重力化率を時間経過で 35% → 100%（10 ticks）へランプアップ
      const timeProgress = Math.min(
        1,
        attractHoldTicks / Math.max(config.attractGravityCancelRampTicks, 1),
      );
      const timeFactor =
        config.attractGravityCancelStart +
        (1 - config.attractGravityCancelStart) * timeProgress;
      const gravityCancelRatio = timeFactor * effectRatio;
      const remainingGravityY =
        (effectRatio - gravityCancelRatio) * MINECRAFT_GRAVITY * dragY;
      targetVel = {
        ...targetVel,
        y: targetVel.y - remainingGravityY,
      };
    }
  } else {
    const outDir =
      distance >= EPSILON ? Vector3Utils.scale(dir, -1) : { x: 0, y: 1, z: 0 };
    const clampedR = Math.max(distance, Math.max(config.repelRefDistance, EPSILON));
    const inverseDistScale = config.repelRefDistance / clampedR;

    if (isEntryTick) {
      const burstFactor = inverseDistScale * effectRatio;
      targetVel = Vector3Utils.add(
        predictedVel,
        Vector3Utils.scale(outDir, config.repelBurstSpeed * burstFactor),
      );
    } else if (repelHoldTicks >= config.repelSustainDelayTicks) {
      const sustainFactor = inverseDistScale * inverseDistScale * effectRatio;
      targetVel = Vector3Utils.add(
        predictedVel,
        Vector3Utils.scale(outDir, config.repelSustainAccel * sustainFactor),
      );
    } else {
      return { x: 0, y: 0, z: 0 };
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
