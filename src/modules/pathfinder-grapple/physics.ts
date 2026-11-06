import { Vector3Utils } from "@minecraft/math";
import { Player, system, Vector3 } from "@minecraft/server";
import {
  calculateVelocityImpulse,
  isInputButtonPressed,
  MINECRAFT_DRAG,
  MINECRAFT_GRAVITY,
  PlayerDirectionResolver,
  PlayerStateManager,
} from "addon-utils";
import { PathfinderActiveState, PathfinderPostFlightState } from "./types";

export const PATHFINDER_POST_FLIGHT_KEY = "pathfinderPostFlightState";

/** 視線・ストレイフによる接線方向ステアリング加速度 (blocks/tick²) */
const STEER_ACCEL = 0.085;
/** ウインチの引き込み加速度 (blocks/tick²) */
const PULL_ACCEL = 0.14;
/** スイング中の最小引き込み速度 (blocks/tick: 横を向いて大回りしている時) */
const MIN_PULL_SPEED = 0.35;
/** 正面視時の最大引き込み速度 (blocks/tick: 直線ジップ移動時) */
const MAX_DIRECT_PULL_SPEED = 1.15;
/** グラップルスイングの最高速度上限 (blocks/tick ≈ 33 m/s) */
const MAX_GRAPPLE_SPEED = 1.65;

/** グラップルジャンプを受け付ける猶予時間 (ticks = 0.6秒) */
const GRAPPLE_JUMP_WINDOW_TICKS = 12;
/** グラップルジャンプの先行入力バッファ (ticks) */
const JUMP_PREBUFFER_TICKS = 3;

/** 切断後の慣性飛行の最大維持時間 (ticks) */
const MAX_POST_FLIGHT_TICKS = 100;
/** 切断後の慣性飛行における水平速度保持率 */
const POST_FLIGHT_RETENTION_XZ = 0.992;

export function getPlayerChestLocation(player: Player): Vector3 {
  const pos = player.location;
  return { x: pos.x, y: pos.y + 1.0, z: pos.z };
}

export function playSoundSafe(
  player: Player,
  soundId: string,
  volume: number,
  pitch: number,
): void {
  try {
    player.playSound(soundId, {
      location: player.location,
      volume,
      pitch,
    });
  } catch {}
}

/**
 * グラップルワイヤーのパーティクル描画
 */
export function renderGrappleWire(player: Player, anchor: Vector3): void {
  try {
    const chest = getPlayerChestLocation(player);
    const diff = Vector3Utils.subtract(anchor, chest);
    const dist = Vector3Utils.magnitude(diff);
    const steps = Math.min(14, Math.max(3, Math.floor(dist * 0.6)));
    const dim = player.dimension;

    for (let i = 1; i <= steps; i++) {
      const t = i / (steps + 1);
      dim.spawnParticle("minecraft:crit", {
        x: chest.x + diff.x * t,
        y: chest.y + diff.y * t,
        z: chest.z + diff.z * t,
      });
    }
  } catch {}
}

/**
 * パスファインダー型グラップルの毎Tick目標速度・インパルス計算
 */
export function calculatePathfinderVelocityImpulse(
  player: Player,
  state: PathfinderActiveState,
  lastJumpPressTick: number,
): Vector3 {
  const chest = getPlayerChestLocation(player);
  const diff = Vector3Utils.subtract(state.anchor, chest);
  const r = Vector3Utils.magnitude(diff);
  if (r < 0.0001) return { x: 0, y: 0, z: 0 };

  const toAnchorDir = Vector3Utils.scale(diff, 1 / r);

  const ticksElapsed = system.currentTick - state.attachedTick;
  const currentVel = player.getVelocity();
  const resolver = PlayerDirectionResolver.get(player);
  const lookDir = resolver.view.vector;
  const worldInput = resolver.worldInput;

  // 1. 基本予測速度（グラップル牽引中は重力を緩和して垂れ下がりを抑える）
  const vBase: Vector3 = {
    x: currentVel.x * 0.99,
    y: (currentVel.y - MINECRAFT_GRAVITY * 0.55) * 0.99,
    z: currentVel.z * 0.99,
  };

  // 2. グラップルジャンプ（初動ジャンプブースト：先行入力＆コヨーテタイム対応）
  const canGrappleJump =
    !state.hasGrappleJumped &&
    ticksElapsed <= GRAPPLE_JUMP_WINDOW_TICKS &&
    (state.startedOnGround || player.isOnGround);

  const wantsJump =
    isInputButtonPressed(player, "Jump") ||
    system.currentTick - lastJumpPressTick <= JUMP_PREBUFFER_TICKS;

  if (canGrappleJump && wantsJump) {
    state.hasGrappleJumped = true;
    state.wasAirborne = true;
    vBase.y = Math.max(vBase.y + 0.4, 0.6);

    const lookXZ = resolver.view.normalizedXZ;
    vBase.x += lookXZ.x * 0.18;
    vBase.z += lookXZ.z * 0.18;

    playSoundSafe(player, "item.trident.throw", 0.85, 1.5);
  }

  // 最短到達距離を更新（ウインチの逆戻り防止）
  state.minReachedDistance = Math.min(state.minReachedDistance, r);

  // 3. アンカー方向（内向き動径成分）と接線成分に分解
  let vInward = Vector3Utils.dot(vBase, toAnchorDir);
  let vTangent = Vector3Utils.subtract(
    vBase,
    Vector3Utils.scale(toAnchorDir, vInward),
  );

  // ワイヤーが外向きに引っ張られている場合、角運動量保存により接線スイング速度へ変換
  if (vInward < 0) {
    const speedBefore = Vector3Utils.magnitude(vBase);
    const tangentMag = Vector3Utils.magnitude(vTangent);
    vInward = 0;
    if (tangentMag > 0.01) {
      const preservedSpeed = tangentMag + (speedBefore - tangentMag) * 0.92;
      vTangent = Vector3Utils.scale(vTangent, preservedSpeed / tangentMag);
    }
  }

  // 4. 視線（3Dカメラ角度）＋ 移動キー入力による接線ステアリング推進力
  const cosTheta = Vector3Utils.dot(toAnchorDir, lookDir);

  let wishDir = lookDir;
  if (worldInput.horizontalLength > 0.1) {
    const blended = {
      x: lookDir.x + worldInput.normalizedXZ.x * 0.35,
      y: lookDir.y,
      z: lookDir.z + worldInput.normalizedXZ.z * 0.35,
    };
    const blendedLen = Vector3Utils.magnitude(blended);
    if (blendedLen > 0.001) {
      wishDir = Vector3Utils.scale(blended, 1 / blendedLen);
    }
  }

  // 視線ベクトルをワイヤーと直交する接平面へ射影
  const wishDotAnchor = Vector3Utils.dot(wishDir, toAnchorDir);
  const steerTangent = Vector3Utils.subtract(
    wishDir,
    Vector3Utils.scale(toAnchorDir, wishDotAnchor),
  );

  vTangent = Vector3Utils.add(
    vTangent,
    Vector3Utils.scale(steerTangent, STEER_ACCEL),
  );

  // アンカーを真っ直ぐ見つめている時（θ < ~23°）は横ブレを減衰させ、ピンポイントに直線着地しやすくする
  if (cosTheta > 0.92 && worldInput.horizontalLength < 0.1) {
    vTangent = Vector3Utils.scale(vTangent, 0.88);
  }

  // 5. 視線角に応じたウインチ牽引（正面視で高速引き寄せ、横向き視で大回りアーク）
  const pullTargetSpeed =
    MIN_PULL_SPEED +
    (MAX_DIRECT_PULL_SPEED - MIN_PULL_SPEED) * Math.max(0, cosTheta);

  vInward = Math.min(pullTargetSpeed, vInward + PULL_ACCEL);

  // ワイヤー伸び防止の位置補正
  const stretch = Math.max(0, r - state.minReachedDistance);
  if (stretch > 0.3) {
    vInward += stretch * 0.18;
  }

  // 6. 目標速度の合成と最高速度クランプ
  let targetVelocity = Vector3Utils.add(
    vTangent,
    Vector3Utils.scale(toAnchorDir, vInward),
  );

  const targetSpeed = Vector3Utils.magnitude(targetVelocity);
  if (targetSpeed > MAX_GRAPPLE_SPEED) {
    targetVelocity = Vector3Utils.scale(
      targetVelocity,
      MAX_GRAPPLE_SPEED / targetSpeed,
    );
  }

  // ワイヤー描画と速度連動ピッチのウインチ効果音
  renderGrappleWire(player, state.anchor);
  if (system.currentTick % 4 === 0) {
    const pitch = Math.min(2.0, 1.15 + targetSpeed * 0.4);
    playSoundSafe(player, "step.chain", 0.35, pitch);
  }

  const isGroundedPull = player.isOnGround && targetVelocity.y <= 0.05;
  return calculateVelocityImpulse({
    targetVelocity,
    currentVelocity: currentVel,
    dragXZ: isGroundedPull
      ? MINECRAFT_DRAG.ground.xz
      : MINECRAFT_DRAG.air.xz,
    dragY: MINECRAFT_DRAG.air.y,
    gravity: MINECRAFT_GRAVITY,
  });
}

/**
 * 空中でスリングショット切断された際、着地まで低空気抵抗な放物線慣性飛行（エアストレイフ維持）を開始します。
 */
export function startPostFlight(player: Player): void {
  if (
    !player.isOnGround &&
    !player.isFlying &&
    !player.isGliding &&
    !player.isInWater
  ) {
    const currentVel = player.getVelocity();
    const horizSpeed = Math.hypot(currentVel.x, currentVel.z);
    if (horizSpeed >= 0.25) {
      const postFlight: PathfinderPostFlightState = {
        detachedTick: system.currentTick,
        lastProcessedTick: system.currentTick,
      };
      PlayerStateManager.set(player.id, PATHFINDER_POST_FLIGHT_KEY, postFlight);
    }
  }
}

/**
 * グラップル切断後の放物線慣性飛行 + Source Engine 風エアストレイフ
 */
export function calculatePostFlightImpulse(
  player: Player,
  postFlight: PathfinderPostFlightState,
): Vector3 | null {
  // 同一Tick内で切断された直後の場合は次Tickまで待機
  if (postFlight.lastProcessedTick === system.currentTick) {
    return null;
  }

  // 着地・水中・飛行状態・時間切れで終了
  if (
    postFlight.lastProcessedTick < system.currentTick - 1 ||
    player.isOnGround ||
    player.isFlying ||
    player.isGliding ||
    player.isInWater ||
    player.isClimbing ||
    system.currentTick - postFlight.detachedTick > MAX_POST_FLIGHT_TICKS
  ) {
    return null;
  }

  const currentVel = player.getVelocity();
  const horizSpeed = Math.hypot(currentVel.x, currentVel.z);

  // 通常ダッシュ速度以下まで減速したら終了
  if (horizSpeed < 0.3) {
    return null;
  }

  postFlight.lastProcessedTick = system.currentTick;

  let nextVx = currentVel.x * POST_FLIGHT_RETENTION_XZ;
  let nextVz = currentVel.z * POST_FLIGHT_RETENTION_XZ;

  // 空中ストレイフ（速度を増大させずに軌道を曲げる）
  const worldInput = PlayerDirectionResolver.get(player).worldInput;
  if (worldInput.horizontalLength > 0.1) {
    const wishDir = worldInput.normalizedXZ;
    const AIR_WISH_SPEED = 0.3;
    const AIR_ACCEL = 0.035;
    const currentProj = nextVx * wishDir.x + nextVz * wishDir.z;
    const addSpeed = AIR_WISH_SPEED - currentProj;

    if (addSpeed > 0) {
      const accelMag = Math.min(AIR_ACCEL, addSpeed);
      const baseSpeed = Math.hypot(nextVx, nextVz);
      nextVx += wishDir.x * accelMag;
      nextVz += wishDir.z * accelMag;

      const newSpeed = Math.hypot(nextVx, nextVz);
      const maxAllowed = Math.max(baseSpeed, AIR_WISH_SPEED);
      if (newSpeed > maxAllowed && newSpeed > 0.001) {
        const scale = maxAllowed / newSpeed;
        nextVx *= scale;
        nextVz *= scale;
      }
    }
  }

  return calculateVelocityImpulse({
    targetVelocity: {
      x: nextVx,
      y: null, // Y軸はバニラ重力に任せる
      z: nextVz,
    },
    currentVelocity: currentVel,
    dragXZ: MINECRAFT_DRAG.air.xz,
    dragY: MINECRAFT_DRAG.air.y,
    gravity: MINECRAFT_GRAVITY,
  });
}
