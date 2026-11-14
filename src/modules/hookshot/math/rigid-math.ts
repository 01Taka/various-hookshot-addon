import { Vector3Utils } from "@minecraft/math";
import { Player, Vector3 } from "@minecraft/server";
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
  const { dir: normal, distance: r } = getDirectionAndDistance(
    anchor,
    player.location,
  );
  if (r < 0.0001) return null;

  const currentVel = player.getVelocity();
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

  // 接線方向（スイングの勢い）を100%維持したまま、法線方向のみを制限して返す
  let target = clampOutwardVelocity(vPred, normal, maxOutwardSpeed);
  const targetSpeed = Vector3Utils.magnitude(target);
  if (targetSpeed > MAX_HOOKSHOT_SPEED) {
    target = Vector3Utils.scale(target, MAX_HOOKSHOT_SPEED / targetSpeed);
  }
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
