import { Vector3Utils } from "@minecraft/math";
import { Player, system, Vector3 } from "@minecraft/server";
import { RigidPhysicsState } from "../types";
import {
  clampOutwardVelocity,
  convertTargetVelocityToImpulse,
  getAirDrag,
  getDirectionAndDistance,
  getNormalComponent,
  predictTickPhysics,
} from "./physics-utils";
import {
  calculateGazeSteeringAcceleration,
  MAX_HOOKSHOT_SPEED,
} from "./steering-math";

export interface RigidHookshotOptions {
  /** 空中ジャンプ入力によって現在短縮（巻き取り）中かどうか */
  isReelingIn?: boolean;
  /** 視線ステアリング推進力を有効にするかどうか */
  enableSteering?: boolean;
  /** ステアリング加速度 (blocks/tick²) */
  steerAccel?: number;
  /** ラグ・ジッター耐性用の前回物理状態（渡された場合は参照更新される） */
  physicsState?: RigidPhysicsState;
}

const VELOCITY_JITTER_RATIO = 0.85;
const MAX_JITTER_GAP_TICKS = 3;
const MAX_TANGENT_RESCALE = 2.0;

/**
 * プレイヤーの現在速度を取得します。
 * サーバーラグ等で getVelocity() が急落している場合、予想座標との誤差が小さければ
 * 衝突（壁スライド等）ではなくジッターとみなし、前Tickの目標速度を維持します。
 */
function resolveEffectiveVelocity(
  player: Player,
  physicsState: RigidPhysicsState | undefined,
  currentTick: number,
): Vector3 {
  const actualVel = player.getVelocity();
  if (!physicsState) return actualVel;

  if (
    player.isOnGround ||
    player.isInWater ||
    player.isClimbing ||
    player.isGliding
  ) {
    return actualVel;
  }

  const dt = currentTick - physicsState.lastTick;
  if (dt < 1 || dt > MAX_JITTER_GAP_TICKS) {
    return actualVel;
  }

  const expectedSpeed = Vector3Utils.magnitude(physicsState.lastTargetVelocity);
  const actualSpeed = Vector3Utils.magnitude(actualVel);

  if (expectedSpeed < 0.05 || actualSpeed >= expectedSpeed * VELOCITY_JITTER_RATIO) {
    return actualVel;
  }

  const expectedDisp = Vector3Utils.scale(physicsState.lastTargetVelocity, dt);
  const actualDisp = Vector3Utils.subtract(
    player.location,
    physicsState.lastLocation,
  );
  const posError = Vector3Utils.magnitude(
    Vector3Utils.subtract(actualDisp, expectedDisp),
  );
  const tolerance = Math.max(0.35, expectedSpeed * 0.4 * dt);

  // 予想座標の付近に到達しているなら壁衝突ではなく速度読み取りジッターと判定
  if (posError <= tolerance) {
    player.sendMessage(
      `§b[RigidDebug] 速度ジッター補完: ${actualSpeed.toFixed(3)} -> ${expectedSpeed.toFixed(3)} (err=${posError.toFixed(3)})`,
    );
    return physicsState.lastTargetVelocity;
  }

  return actualVel;
}

/**
 * 法線方向の拘束速度は維持したまま、直交射影で失われた速さを接線方向に補填します。
 */
function preserveTangentialSpeed(
  player: Player,
  target: Vector3,
  vPred: Vector3,
  normal: Vector3,
  predSpeed: number,
): Vector3 {
  if (predSpeed <= 0.05 || Vector3Utils.dot(target, vPred) <= 0) {
    return target;
  }

  const targetSpeed = Vector3Utils.magnitude(target);
  if (targetSpeed >= predSpeed) {
    return target;
  }

  const vnTarget = Vector3Utils.dot(target, normal);
  const vt = Vector3Utils.subtract(target, Vector3Utils.scale(normal, vnTarget));
  const vtLen = Vector3Utils.magnitude(vt);
  if (vtLen <= 0.0001) {
    return target;
  }

  const vtDesired = Math.sqrt(Math.max(0, predSpeed * predSpeed - vnTarget * vnTarget));
  const scale = Math.min(vtDesired / vtLen, MAX_TANGENT_RESCALE);
  if (scale <= 1.001) {
    return target;
  }

  const restored = Vector3Utils.add(
    Vector3Utils.scale(vt, scale),
    Vector3Utils.scale(normal, vnTarget),
  );
  const restoredSpeed = Vector3Utils.magnitude(restored);
  player.sendMessage(
    `§e[RigidDebug] エネルギー補完: ${targetSpeed.toFixed(3)} -> ${restoredSpeed.toFixed(3)} (x${scale.toFixed(3)})`,
  );
  return restored;
}

function updatePhysicsState(
  physicsState: RigidPhysicsState | undefined,
  velocity: Vector3,
  location: Vector3,
  tick: number,
  wasTaut: boolean,
): void {
  if (!physicsState) return;
  physicsState.lastTargetVelocity = velocity;
  physicsState.lastLocation = location;
  physicsState.lastTick = tick;
  physicsState.wasTaut = wasTaut;
}

/**
 * 速度射影 + Baumgarte安定化（位置補正）に基づき、
 * 伸びのない剛体ロープ拘束を満たす目標速度を計算します。
 */
export function calculateRigidVelocity(
  player: Player,
  anchor: Vector3,
  ropeLength: number,
  options?: RigidHookshotOptions,
): Vector3 | null {
  const currentLoc = player.location;
  const { dir: normal, distance: r } = getDirectionAndDistance(
    anchor,
    currentLoc,
  );
  if (r < 0.0001) return null;

  const currentTick = system.currentTick;
  const physicsState = options?.physicsState;
  const wasTaut = physicsState?.wasTaut ?? false;

  const currentVel = resolveEffectiveVelocity(player, physicsState, currentTick);
  const speed = Vector3Utils.magnitude(currentVel);

  // 1. アドオンがシミュレートしたい環境抵抗（空気抵抗0.99）を適用した予測速度
  let vPred = predictTickPhysics({
    velocity: currentVel,
    dragXZ: getAirDrag(speed),
  });

  // 2. 空中ジャンプ巻き取り中かつロープが張っている場合、視線ステアリング推進力を加算
  const isTaut = r >= ropeLength - 0.25;
  const isSteeringActive = !!(
    options?.enableSteering &&
    options?.isReelingIn &&
    isTaut
  );

  if (isSteeringActive) {
    const steer = calculateGazeSteeringAcceleration(
      player,
      anchor,
      options?.steerAccel,
    );
    vPred = Vector3Utils.add(vPred, steer);

    const predSpeed = Vector3Utils.magnitude(vPred);
    if (predSpeed > MAX_HOOKSHOT_SPEED) {
      vPred = Vector3Utils.scale(vPred, MAX_HOOKSHOT_SPEED / predSpeed);
    }
  }

  const vn = getNormalComponent(vPred, normal);
  const predDistance = r + vn;

  // 3. たるみ判定：次Tickの予測距離がロープ長以内であれば、外力不要（完全な自由落下）
  // ※ステアリング推進力が加わっている場合は、接線速度を反映するため null ではなく目標速度を返す
  if (predDistance <= ropeLength) {
    updatePhysicsState(physicsState, vPred, currentLoc, currentTick, false);
    if (isSteeringActive) {
      return vPred;
    }
    return null;
  }

  // 4. 拘束適用：ロープ長を超える外向き成分をクランプ
  const penetration = Math.max(0, r - ropeLength);
  const BAUMGARTE_FACTOR = 0.15;

  // まだはみ出ていない場合はちょうどロープ長に留まる速度 (ropeLength - r) を上限とし、
  // すでにはみ出ている場合のみマイルドに内側へ引き戻す (-penetration * 0.15)
  const maxOutwardSpeed =
    penetration > 0
      ? -penetration * BAUMGARTE_FACTOR
      : Math.max(0, ropeLength - r);

  // 接線方向（スイングの勢い）を維持したまま、法線方向のみを制限して返す
  const predSpeed = Vector3Utils.magnitude(vPred);
  let target = clampOutwardVelocity(vPred, normal, maxOutwardSpeed);
  if (wasTaut) {
    target = preserveTangentialSpeed(player, target, vPred, normal, predSpeed);
  }

  const targetSpeed = Vector3Utils.magnitude(target);
  if (targetSpeed > MAX_HOOKSHOT_SPEED) {
    target = Vector3Utils.scale(target, MAX_HOOKSHOT_SPEED / targetSpeed);
  }
  updatePhysicsState(physicsState, target, currentLoc, currentTick, true);
  return target;
}

export function calculateRigidHookshot(
  player: Player,
  anchor: Vector3,
  ropeLength: number,
  options?: RigidHookshotOptions,
): Vector3 {
  const velocity = calculateRigidVelocity(player, anchor, ropeLength, options);
  return convertTargetVelocityToImpulse(player, velocity);
}
