import { Vector3Utils } from "@minecraft/math";
import { Player, Vector3 } from "@minecraft/server";
import { MINECRAFT_GRAVITY } from "addon-utils";
import { EPSILON, RADIAL_CORRECTION_GAIN } from "../../constants";
import {
  convertTargetVelocityToImpulse,
  getAirDrag,
  getDirectionAndDistance,
  getNormalComponent,
  predictTickPhysics,
} from "../../math/physics-utils";
import {
  calculateAboveAnchorDecayFactor,
  calculatePendulumPumpAcceleration,
  calculateRigidSteering,
  RigidSteeringConfig,
} from "../../math/steering-math";
import { RigidHookshotOptions, RigidPhysicsConfig } from "./type";

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

  const hasAeroVest = options.hasAeroVest ?? false;

  // 1. 空中ジャンプ巻き取り中かつロープが張っている場合、ステアリングと3D遠心力を計算
  const isTaut = r >= ropeLength - physics.tautMargin;
  const isSteeringActive = !!(
    options.enableSteering &&
    options.isReelingIn &&
    isTaut
  );

  const steerResult = isSteeringActive
    ? calculateRigidSteering(player, anchor, steering, hasAeroVest)
    : null;
  const isSteeringApplied = !!(
    steerResult &&
    (steerResult.steerRatio > 0 || steerResult.centrifugal3DRatio > 0)
  );

  const c3D = steerResult ? steerResult.centrifugal3DRatio : 0;

  // エアロベスト装着時は巻き取り中（直線巻き取り含む）のみ重力を少し減らす
  const gravityScale =
    hasAeroVest && options.isReelingIn
      ? Math.max(0, Math.min(1, physics.reelGravityScaleVest ?? 1.0))
      : 1.0;
  const isGravityReduced = gravityScale < 1.0 - EPSILON;
  const effectiveGravity = MINECRAFT_GRAVITY * gravityScale;

  // 3D遠心力比率に応じて接線速度の空気抵抗を軽減し、ベクトルの長さを維持しやすくする（ベスト装着時のみ）
  const baseDragXZ = getAirDrag(speed);
  const effectiveDragXZ = baseDragXZ + (1.0 - baseDragXZ) * c3D;

  const effectiveMaxSteeringSpeed = hasAeroVest
    ? physics.maxSteeringSpeed
    : (physics.maxSteeringSpeedNormal ?? physics.maxSteeringSpeed);

  // 2. 環境抵抗（空気抵抗）と調整後重力を適用した予測速度
  let vPred = predictTickPhysics({
    velocity: currentVel,
    dragXZ: effectiveDragXZ,
    gravity: effectiveGravity,
  });

  if (isSteeringApplied && steerResult) {
    // 離散Tickでの円弧移動によって外向き（normal方向）へ逃げた接線速度成分を回収
    const currentLat = Vector3Utils.dot(vPred, steerResult.lateralDir);
    let baseLat = currentLat;
    if (currentLat > 0 && steerResult.steerRatio > 0) {
      const vnBefore = Vector3Utils.dot(vPred, normal);
      if (vnBefore > 0) {
        const maxCurveOutward = (currentLat * currentLat) / Math.max(r, 1.5);
        const curveOutward = Math.min(vnBefore, maxCurveOutward);
        const arcSpeed = Math.hypot(currentLat, curveOutward);
        baseLat =
          currentLat + (arcSpeed - currentLat) * steerResult.steerRatio;
      }
    }

    // 水平接線方向へステアリング加速度を加算
    const targetLat =
      steerResult.tangentialAccel > 0
        ? Math.min(
            effectiveMaxSteeringSpeed,
            baseLat + steerResult.tangentialAccel,
          )
        : baseLat;
    const deltaLat = targetLat - currentLat;
    if (deltaLat !== 0) {
      vPred = Vector3Utils.add(
        vPred,
        Vector3Utils.scale(steerResult.lateralDir, deltaLat),
      );
    }

    // 接線平面（lateralDir, upNormal）上の速度ベクトルの長さを維持しつつ上方向へ回転（ベスト装着時のみ）
    // ※ アンカーより上（!isBelowAnchor）では下向き落下速度を無理に水平へ戻さない。
    //    アンカーより上にいる間は時間経過で減衰し、下へ戻ると待機時間後に徐々に回復する。
    const aboveAnchorDecayFactor = calculateAboveAnchorDecayFactor(
      options.aboveAnchorTicks ?? 0,
      steering,
    );
    const vLat = Vector3Utils.dot(vPred, steerResult.lateralDir);
    const vUp = Vector3Utils.dot(vPred, steerResult.upNormal);
    if (
      steerResult.isBelowAnchor &&
      aboveAnchorDecayFactor > 0 &&
      vLat > EPSILON &&
      c3D > 0
    ) {
      const planeSpeed = Math.min(
        effectiveMaxSteeringSpeed,
        Math.hypot(vLat, vUp),
      );
      const currentTiltRad = Math.atan2(vUp, vLat);
      if (steerResult.targetTiltRad > currentTiltRad) {
        const rate =
          Math.max(0, Math.min(1, steering.tiltRatePerTick)) *
          c3D *
          aboveAnchorDecayFactor;
        const nextTiltRad =
          currentTiltRad + (steerResult.targetTiltRad - currentTiltRad) * rate;
        const nextLat = planeSpeed * Math.cos(nextTiltRad);
        const nextUp = planeSpeed * Math.sin(nextTiltRad);
        vPred = Vector3Utils.add(
          vPred,
          Vector3Utils.add(
            Vector3Utils.scale(steerResult.lateralDir, nextLat - vLat),
            Vector3Utils.scale(steerResult.upNormal, nextUp - vUp),
          ),
        );
      }
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
    let pump = calculatePendulumPumpAcceleration(
      player,
      normal,
      vPred,
      options.swingPumpAccel,
      steering.pumpLowSpeedStart,
      steering.pumpLowSpeedEnd,
    );
    if (options.suppressPumpParallelDir) {
      const hx = options.suppressPumpParallelDir.x;
      const hz = options.suppressPumpParallelDir.z;
      const hLen = Math.hypot(hx, hz);
      if (hLen > EPSILON) {
        const ux = hx / hLen;
        const uz = hz / hLen;
        const parallel = pump.x * ux + pump.z * uz;
        pump = {
          x: pump.x - ux * parallel,
          y: pump.y,
          z: pump.z - uz * parallel,
        };
      }
    }
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
  // ※ステアリング推進力・振り子加速・巻き取り中の重力軽減が加わっている場合は目標速度を返す
  if (predDistance <= ropeLength) {
    if (isSteeringApplied || isPumpApplied || isGravityReduced) {
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
