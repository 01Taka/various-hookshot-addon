import { Vector3Utils } from "@minecraft/math";
import { Player, Vector3 } from "@minecraft/server";
import {
  convertTargetVelocityToImpulse,
  getAirDrag,
  getDirectionAndDistance,
  getNormalComponent,
  predictTickPhysics,
} from "./physics-utils";
import {
  calculateGazeSteeringAcceleration,
  calculatePendulumPumpAcceleration,
} from "./steering-math";

export interface RigidHookshotOptions {
  /** 空中ジャンプ入力によって現在短縮（巻き取り）中かどうか */
  isReelingIn?: boolean;
  /** 視線ステアリング推進力を有効にするかどうか */
  enableSteering?: boolean;
  /** ステアリング加速度 (blocks/tick²) */
  steerAccel?: number;
  /** ステアリング加速時の最高速度上限 (blocks/tick、省略時は上限なし) */
  maxSteeringSpeed?: number;
  /** 非巻き取り時の振り子スイング追加加速度 (blocks/tick²) */
  swingPumpAccel?: number;
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

    if (options?.maxSteeringSpeed !== undefined) {
      const predSpeed = Vector3Utils.magnitude(vPred);
      if (predSpeed > options.maxSteeringSpeed) {
        vPred = Vector3Utils.scale(
          vPred,
          options.maxSteeringSpeed / predSpeed,
        );
      }
    }
  }

  // 3. 内側スイング継続ゾーン：内側2m以内でアンカーより下側にいる空中時は
  //    自由落下に落とさず振り子運動を続け、水平に近づくほど（二乗カーブで）力を抜いて
  //    上側では完全に無効化しつつ、なめらかに実際のロープ長へ戻す
  const INNER_SWING_MARGIN = 2.0;
  const INNER_BAUMGARTE_FACTOR = 0.08;
  const INWARD_ESCAPE_THRESHOLD = 0.45;
  const bottomWeight = Math.max(0, -normal.y);
  const radialWeight = bottomWeight * bottomWeight;

  const inInnerSwingZone =
    !player.isOnGround &&
    !options?.isReelingIn &&
    r < ropeLength &&
    r >= ropeLength - INNER_SWING_MARGIN &&
    radialWeight > 0;

  // 2.5 非巻き取り時の振り子スイング追加加速度（空中かつロープが張っている／内側スイング中のみ）
  let isPumpApplied = false;
  if (
    !player.isOnGround &&
    !options?.isReelingIn &&
    options?.swingPumpAccel &&
    (isTaut || inInnerSwingZone)
  ) {
    const pump = calculatePendulumPumpAcceleration(
      player,
      normal,
      vPred,
      options.swingPumpAccel,
    );
    if (pump.x !== 0 || pump.y !== 0 || pump.z !== 0) {
      vPred = Vector3Utils.add(vPred, pump);
      isPumpApplied = true;
    }
  }

  const vn = getNormalComponent(vPred, normal);
  const predDistance = r + vn;
  const RADIAL_CORRECTION_GAIN = 0.7;

  if (inInnerSwingZone && vn > -INWARD_ESCAPE_THRESHOLD) {
    const vtVec = Vector3Utils.subtract(vPred, Vector3Utils.scale(normal, vn));
    const targetRadialSpeed =
      (ropeLength - r) * INNER_BAUMGARTE_FACTOR * radialWeight;
    const effectiveGain = RADIAL_CORRECTION_GAIN * radialWeight;
    const dampedRadialSpeed = vn + (targetRadialSpeed - vn) * effectiveGain;
    return Vector3Utils.add(
      vtVec,
      Vector3Utils.scale(normal, dampedRadialSpeed),
    );
  }

  // 4. たるみ判定：次Tickの予測距離がロープ長以内であれば、外力不要（完全な自由落下）
  // ※ステアリング推進力や振り子加速が加わっている場合は、接線速度を反映するため null ではなく目標速度を返す
  if (predDistance <= ropeLength) {
    if (isSteeringActive || isPumpApplied) {
      return vPred;
    }
    return null;
  }

  // 5. 拘束適用：ロープ長を超える外向き成分をクランプ（同期遅延による発振防止のためゲイン0.7で適用）
  const penetration = Math.max(0, r - ropeLength);
  const BAUMGARTE_FACTOR = 0.15;

  // まだはみ出ていない場合はちょうどロープ長に留まる速度 (ropeLength - r) を上限とし、
  // すでにはみ出ている場合のみマイルドに内側へ引き戻す (-penetration * 0.15)
  const maxOutwardSpeed =
    penetration > 0
      ? -penetration * BAUMGARTE_FACTOR
      : Math.max(0, ropeLength - r);

  // 接線方向（スイングの勢い）を100%維持したまま、法線方向のみをゲイン付きで制限して返す
  const excess = Math.max(0, vn - maxOutwardSpeed);
  return excess > 0
    ? Vector3Utils.subtract(
        vPred,
        Vector3Utils.scale(normal, excess * RADIAL_CORRECTION_GAIN),
      )
    : vPred;
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
