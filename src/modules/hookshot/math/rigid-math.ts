import { Vector3Utils } from "@minecraft/math";
import { Player, Vector3 } from "@minecraft/server";
import {
  BAUMGARTE_FACTOR,
  EPSILON,
  RADIAL_CORRECTION_GAIN,
} from "../constants";
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
  RigidSteeringConfig,
} from "./steering-math";

export interface RigidPhysicsConfig {
  /** ロープが張っているとみなす自然長からの許容マージン (blocks) */
  tautMargin: number;
  /** 内側スイング継続ゾーンの幅 (blocks) */
  innerSwingMargin: number;
  /** 内側スイング継続ゾーンでの緩やかな復元係数 */
  innerBaumgarteFactor: number;
  /** 内側スイング継続ゾーンから自由落下へ抜ける内向き速度閾値 (blocks/tick) */
  inwardEscapeThreshold: number;
  /** ステアリング加速時の最高速度上限 (blocks/tick) */
  maxSteeringSpeed: number;
  /** 非巻き取り時の振り子スイング追加加速度（通常時, blocks/tick²） */
  swingPumpAccelNormal: number;
  /** 非巻き取り時の振り子スイング追加加速度（エアロベスト装備時, blocks/tick²） */
  swingPumpAccelVest: number;
}

export interface RigidHookshotOptions {
  /** 空中ジャンプ入力によって現在短縮（巻き取り）中かどうか */
  isReelingIn?: boolean;
  /** 張った状態での当Tickの実巻き取り速度 (blocks/tick) */
  reelingSpeed?: number;
  /** 視線ステアリング推進力を有効にするかどうか */
  enableSteering?: boolean;
  /** 剛体ロープ物理パラメータ */
  physics: RigidPhysicsConfig;
  /** 視線ステアリングパラメータ */
  steering: RigidSteeringConfig;
  /** 非巻き取り時の振り子スイング追加加速度 (blocks/tick²) */
  swingPumpAccel: number;
}

/**
 * 速度射影 + Baumgarte安定化（位置補正）に基づき、
 * 伸びのない剛体ロープ拘束を満たす目標速度を計算します。
 */
export function calculateRigidVelocity(
  player: Player,
  anchor: Vector3,
  ropeLength: number,
  options: RigidHookshotOptions,
): Vector3 | null {
  const { dir: normal, distance: r } = getDirectionAndDistance(
    anchor,
    player.location,
  );
  if (r < EPSILON) return null;

  const currentVel = player.getVelocity();
  const speed = Vector3Utils.magnitude(currentVel);
  const { physics, steering } = options;

  // 1. アドオンがシミュレートしたい環境抵抗（空気抵抗）を適用した予測速度
  let vPred = predictTickPhysics({
    velocity: currentVel,
    dragXZ: getAirDrag(speed),
  });

  // 2. 空中ジャンプ巻き取り中かつロープが張っている場合、視線ステアリング推進力を加算
  const isTaut = r >= ropeLength - physics.tautMargin;
  const isSteeringActive = !!(
    options.enableSteering &&
    options.isReelingIn &&
    isTaut
  );

  if (isSteeringActive) {
    const steer = calculateGazeSteeringAcceleration(player, anchor, steering);
    vPred = Vector3Utils.add(vPred, steer);

    const predSpeed = Vector3Utils.magnitude(vPred);
    if (predSpeed > physics.maxSteeringSpeed) {
      vPred = Vector3Utils.scale(
        vPred,
        physics.maxSteeringSpeed / predSpeed,
      );
    }
  }

  // 3. 内側スイング継続ゾーン：内側にいてアンカーより下側にいる空中時は
  //    自由落下に落とさず振り子運動を続け、水平に近づくほど（二乗カーブで）力を抜いて
  //    上側では完全に無効化しつつ、なめらかに実際のロープ長へ戻す
  const bottomWeight = Math.max(0, -normal.y);
  const radialWeight = bottomWeight * bottomWeight;

  const inInnerSwingZone =
    !player.isOnGround &&
    !options.isReelingIn &&
    r < ropeLength &&
    r >= ropeLength - physics.innerSwingMargin &&
    radialWeight > 0;

  // 2.5 非巻き取り時の振り子スイング追加加速度（空中かつロープが張っている／内側スイング中のみ）
  let isPumpApplied = false;
  if (
    !player.isOnGround &&
    !options.isReelingIn &&
    options.swingPumpAccel > 0 &&
    (isTaut || inInnerSwingZone)
  ) {
    const pump = calculatePendulumPumpAcceleration(
      player,
      normal,
      vPred,
      options.swingPumpAccel,
      steering.pumpLowSpeedStart,
      steering.pumpLowSpeedEnd,
    );
    if (pump.x !== 0 || pump.y !== 0 || pump.z !== 0) {
      vPred = Vector3Utils.add(vPred, pump);
      isPumpApplied = true;
    }
  }

  const vn = getNormalComponent(vPred, normal);
  const predDistance = r + vn;

  if (inInnerSwingZone && vn > -physics.inwardEscapeThreshold) {
    const vtVec = Vector3Utils.subtract(vPred, Vector3Utils.scale(normal, vn));
    const targetRadialSpeed =
      (ropeLength - r) * physics.innerBaumgarteFactor * radialWeight;
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

  // 5. 拘束適用：ロープ長を超える外向き成分をクランプ（同期遅延による発振防止のためゲインで適用）
  const penetration = Math.max(0, r - ropeLength);
  const reelingSpeed = Math.max(0, options.reelingSpeed ?? 0);

  // まだはみ出ていない場合はちょうどロープ長に留まる速度 (ropeLength - r) を上限とし、
  // すでにはみ出ている場合のみマイルドに内側へ引き戻す (-penetration * BAUMGARTE_FACTOR)
  // 張った状態での能動巻き取り中は、巻き取り速度 (-reelingSpeed) を直接目標速度へ加算する
  const maxOutwardSpeed =
    (penetration > 0
      ? -penetration * BAUMGARTE_FACTOR
      : Math.max(0, ropeLength - r)) - reelingSpeed;

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
  options: RigidHookshotOptions,
): Vector3 {
  const velocity = calculateRigidVelocity(player, anchor, ropeLength, options);
  return convertTargetVelocityToImpulse(player, velocity);
}
