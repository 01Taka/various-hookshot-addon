import { Vector3Utils } from "@minecraft/math";
import { Player, Vector3 } from "@minecraft/server";
import { MINECRAFT_GRAVITY } from "addon-utils";
import { EPSILON, RADIAL_CORRECTION_GAIN } from "../constants";
import {
  convertTargetVelocityToImpulse,
  getAirDrag,
  getDirectionAndDistance,
  getNormalComponent,
  predictTickPhysics,
} from "./physics-utils";
import {
  calculatePendulumPumpAcceleration,
  calculateRigidSteering,
  cancelPreInputReverseVelocity,
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
  /** アンカーが着弾した直後の初回物理Tickかどうか */
  isAttachTick?: boolean;
  /** 空中ジャンプ入力によって現在短縮（巻き取り）中かどうか */
  isReelingIn?: boolean;
  /** 視線ステアリング推進力を有効にするかどうか */
  enableSteering?: boolean;
  /** Baumgarte 位置誤差安定化係数 */
  baumgarteFactor: number;
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

  // 1. 空中ジャンプ巻き取り中かつロープが張っている場合、自動バンク平面ステアリングを計算
  const isTaut = r >= ropeLength - physics.tautMargin;
  const isSteeringActive = !!(
    options.enableSteering &&
    options.isReelingIn &&
    isTaut
  );

  const steerResult = isSteeringActive
    ? calculateRigidSteering(player, anchor, steering)
    : null;
  const isSteeringApplied = !!(steerResult && steerResult.steerRatio > 0);

  // 横旋回比率に応じて重力を軽減（最大旋回時でも minGravityRatio 分の重力は残す）
  const minGravityRatio = Math.max(
    0,
    Math.min(1, steering.minGravityRatio),
  );
  const effectiveGravity = isSteeringApplied
    ? MINECRAFT_GRAVITY *
      (1 - steerResult.steerRatio * (1 - minGravityRatio))
    : MINECRAFT_GRAVITY;

  // 2. 環境抵抗（空気抵抗）と調整後重力を適用した予測速度
  let vPred = predictTickPhysics({
    velocity: currentVel,
    dragXZ: getAirDrag(speed),
    gravity: effectiveGravity,
  });

  // 2.1 アンカー着弾直後の初回Tickで A/D が先行入力されている場合、逆回転方向の速度を打ち消す
  let isReverseCanceled = false;
  if (options.isAttachTick && options.enableSteering) {
    const cancelResult = cancelPreInputReverseVelocity(
      player,
      anchor,
      vPred,
      steering,
    );
    if (cancelResult.canceled) {
      vPred = cancelResult.velocity;
      isReverseCanceled = true;
    }
  }

  if (isSteeringApplied && steerResult) {
    // 自動バンク平面より下向きに落ちる速度成分（vNp < 0）のみを減衰し、上向き慣性は維持
    const vNp = Vector3Utils.dot(vPred, steerResult.planeNormal);
    if (vNp < 0 && steering.planeDownwardDamping > 0) {
      const damp =
        vNp *
        Math.min(1, steering.planeDownwardDamping) *
        steerResult.steerRatio;
      vPred = Vector3Utils.subtract(
        vPred,
        Vector3Utils.scale(steerResult.planeNormal, damp),
      );
    }

    // 離散Tickでの円弧移動によって外向き（normal方向）へ逃げた接線速度成分を回収し、
    // 回転を続けるごとに接線回転速度が落ちず連続的に加速し続けるようにする
    const currentVt = Vector3Utils.dot(vPred, steerResult.tangentDir);
    let baseVt = currentVt;
    if (steerResult.hasADPriority && currentVt < 0) {
      // A/D 入力時は逆回転の接線速度を打ち消してから加速を開始する
      baseVt = 0;
    } else if (currentVt > 0) {
      const vnBefore = Vector3Utils.dot(vPred, normal);
      if (vnBefore > 0) {
        const maxCurveOutward = (currentVt * currentVt) / Math.max(r, 1.5);
        const curveOutward = Math.min(vnBefore, maxCurveOutward);
        const arcSpeed = Math.hypot(currentVt, curveOutward);
        baseVt =
          currentVt + (arcSpeed - currentVt) * steerResult.steerRatio;
      }
    }

    // 接線方向の回転速度に対して直接加速度を加算（巻き取りの内向き速度と干渉させずに maxSteeringSpeed で上限管理）
    const targetVt = Math.min(
      physics.maxSteeringSpeed,
      baseVt + steerResult.tangentialAccel,
    );
    const deltaVt = targetVt - currentVt;
    if (deltaVt !== 0) {
      vPred = Vector3Utils.add(
        vPred,
        Vector3Utils.scale(steerResult.tangentDir, deltaVt),
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
    if (isSteeringApplied || isPumpApplied || isReverseCanceled) {
      return vPred;
    }
    return null;
  }

  // 5. 拘束適用：ロープ長を超える外向き成分をクランプ（同期遅延による発振防止のためゲインで適用）
  const penetration = Math.max(0, r - ropeLength);

  // まだはみ出ていない場合はちょうどロープ長に留まる速度 (ropeLength - r) を上限とし、
  // すでにはみ出ている場合のみマイルドに内側へ引き戻す (-penetration * BAUMGARTE_FACTOR)
  const maxOutwardSpeed =
    penetration > 0
      ? -penetration * options.baumgarteFactor
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
  options: RigidHookshotOptions,
): Vector3 {
  const velocity = calculateRigidVelocity(player, anchor, ropeLength, options);
  return convertTargetVelocityToImpulse(player, velocity);
}
