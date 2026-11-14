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
const MAX_TANGENT_RESCALE = 1.5;
const OUTER_BAUMGARTE_FACTOR = 0.2;
const INNER_BAUMGARTE_FACTOR = 0.08;
const INNER_SWING_MARGIN = 2.0;
const SLACK_HYSTERESIS = 0.5;

interface EffectiveVelocityResult {
  velocity: Vector3;
  isUnobstructed: boolean;
}

/**
 * プレイヤーの現在速度を取得し、壁衝突等がないか判定します。
 * サーバーラグ等で getVelocity() が急落している場合、予想座標との誤差が小さければ
 * 衝突（壁スライド等）ではなくジッターとみなし、前Tickの目標速度を維持します。
 */
function resolveEffectiveVelocity(
  player: Player,
  physicsState: RigidPhysicsState | undefined,
  currentTick: number,
): EffectiveVelocityResult {
  const actualVel = player.getVelocity();
  if (!physicsState) {
    return { velocity: actualVel, isUnobstructed: false };
  }

  if (
    player.isOnGround ||
    player.isInWater ||
    player.isClimbing ||
    player.isGliding
  ) {
    return { velocity: actualVel, isUnobstructed: false };
  }

  const dt = currentTick - physicsState.lastTick;
  if (dt < 1 || dt > MAX_JITTER_GAP_TICKS) {
    return { velocity: actualVel, isUnobstructed: false };
  }

  const expectedSpeed = Vector3Utils.magnitude(physicsState.lastTargetVelocity);
  const actualSpeed = Vector3Utils.magnitude(actualVel);

  if (expectedSpeed < 0.05) {
    return { velocity: actualVel, isUnobstructed: true };
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

  // 予想座標付近へ進んでいるか、実移動速度と方向が維持されていれば壁衝突ではないと判定
  const dispSpeed = Vector3Utils.magnitude(actualDisp) / dt;
  const dispAlignment =
    dispSpeed > 0.05
      ? Vector3Utils.dot(actualDisp, expectedDisp) /
        (dispSpeed * dt * expectedSpeed)
      : 0;
  const isUnobstructed =
    posError <= tolerance ||
    (dispSpeed >= expectedSpeed * 0.75 && dispAlignment >= 0.7);

  if (actualSpeed < expectedSpeed * VELOCITY_JITTER_RATIO && posError <= tolerance) {
    return {
      velocity: physicsState.lastTargetVelocity,
      isUnobstructed: true,
    };
  }

  return { velocity: actualVel, isUnobstructed };
}

/**
 * インパルス抜けやバウンシングによって法線方向に漏れた速度成分を、
 * 重力加算前に接線方向へ回転復元し、スイングの運動エネルギー損失を防ぎます。
 */
function redirectRadialBounceToTangent(
  velocity: Vector3,
  normal: Vector3,
  includeInward: boolean,
): Vector3 {
  const vn = Vector3Utils.dot(velocity, normal);
  const shouldRedirect = vn > 0 || (includeInward && vn > -0.5 && vn < 0);
  if (!shouldRedirect) {
    return velocity;
  }

  const vt = Vector3Utils.subtract(velocity, Vector3Utils.scale(normal, vn));
  const vtLen = Vector3Utils.magnitude(vt);
  if (vtLen <= 0.0001) {
    return velocity;
  }

  const speed = Vector3Utils.magnitude(velocity);
  const scale = Math.min(speed / vtLen, MAX_TANGENT_RESCALE);
  return Vector3Utils.scale(vt, scale);
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
 * 球面幾何拘束 + Baumgarte安定化（位置補正）に基づき、
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

  const { velocity: rawVel, isUnobstructed } = resolveEffectiveVelocity(
    player,
    physicsState,
    currentTick,
  );

  // スイング継続中かつ壁衝突がない場合、ラグや跳ねで法線方向に漏れた慣性速度を接線方向に復元
  const allowInwardRedirect =
    !options?.isReelingIn &&
    r >= ropeLength - INNER_SWING_MARGIN &&
    normal.y <= 0.15;
  const currentVel =
    wasTaut && isUnobstructed
      ? redirectRadialBounceToTangent(rawVel, normal, allowInwardRedirect)
      : rawVel;
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
  const vtVec = Vector3Utils.subtract(vPred, Vector3Utils.scale(normal, vn));
  const vt = Vector3Utils.magnitude(vtVec);

  const penetration = Math.max(0, r - ropeLength);
  const inInnerSwingZone =
    wasTaut &&
    penetration === 0 &&
    r >= ropeLength - INNER_SWING_MARGIN &&
    normal.y <= 0.15 &&
    vn > -0.5;

  let targetRadius = ropeLength;
  if (penetration > 0) {
    targetRadius = r - penetration * OUTER_BAUMGARTE_FACTOR;
  } else if (inInnerSwingZone) {
    // 内側侵入時は自由落下に落とさず、なめらかに実際のロープ長へ戻す
    targetRadius = r + (ropeLength - r) * INNER_BAUMGARTE_FACTOR;
  }

  // 1Tick後に接線方向へ vt 進んでも半径 targetRadius の球面上に収まる法線速度
  const maxRadialPos = Math.max(
    targetRadius * 0.5,
    Math.sqrt(Math.max(0, targetRadius * targetRadius - vt * vt)),
  );
  const targetRadialSpeed = maxRadialPos - r;

  // 3. たるみ判定：内側スイング継続ゾーン外で、現在はみ出ておらず次Tickも球面内に収まる場合は自由落下
  if (!inInnerSwingZone && penetration === 0 && vn <= targetRadialSpeed) {
    const keepTaut = wasTaut && r >= ropeLength - SLACK_HYSTERESIS;
    updatePhysicsState(physicsState, vPred, currentLoc, currentTick, keepTaut);
    if (isSteeringActive) {
      return vPred;
    }
    return null;
  }

  // 4. 拘束適用：内側スイング継続中は法線速度を目標径方向速度に揃えて跳ねを抑制、それ以外は外向き成分をクランプ
  let target = inInnerSwingZone
    ? Vector3Utils.add(vtVec, Vector3Utils.scale(normal, targetRadialSpeed))
    : clampOutwardVelocity(vPred, normal, targetRadialSpeed);

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
