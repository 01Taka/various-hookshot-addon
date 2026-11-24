import { Vector3Utils } from "@minecraft/math";
import { Player, Vector3 } from "@minecraft/server";
import { calculateRigidHookshot, RigidPhysicsConfig } from "./rigid-math";
import { RigidSteeringConfig } from "./steering-math";

export interface ZiplineRailPhysicsConfig {
  /** 入力（Jump / Shift）によるレール上の加速度 (blocks/tick²) */
  inputAccel: number;
  /** レール斜度に対する重力加速度係数 (blocks/tick²) */
  railGravity: number;
  /** 通常走行時の速度減衰（摩擦）係数 (per tick) */
  friction: number;
  /** 同時押し（ブレーキ）時の速度減衰係数 (per tick) */
  brakeFriction: number;
  /** レール上の最大移動速度 (blocks/tick) */
  maxRailSpeed: number;
  /** プレイヤー胴からアンカーまでの最大許容距離 (blocks, 鎖4.0m + 許容2.0m = 6.0m) */
  maxAnchorDistance: number;
  /** プレイヤー足元から胴接続点までのYオフセット (blocks) */
  torsoHeightOffset: number;
  /** 最小停止速度閾値 (blocks/tick) */
  stopSpeedThreshold: number;
}

export interface ZiplineRailStepInput {
  railStart: Vector3;
  railEnd: Vector3;
  railLength: number;
  railProgress: number;
  railVelocity: number;
  dimensionId: string;
  jumpPressed: boolean;
  sneakPressed: boolean;
  playerLocation: Vector3;
  config: ZiplineRailPhysicsConfig;
}

export interface ZiplineRailStepResult {
  railProgress: number;
  railVelocity: number;
  anchor: Vector3 & { dimensionId: string };
}

/**
 * レール上の1次元アンカー移動物理を計算します。
 * a_rail = F_input - g_rail * sin(theta) - mu * v_rail
 */
export function stepZiplineRailAnchor(
  input: ZiplineRailStepInput,
): ZiplineRailStepResult {
  const {
    railStart,
    railEnd,
    railLength,
    dimensionId,
    jumpPressed,
    sneakPressed,
    playerLocation,
    config,
  } = input;

  if (railLength <= 0.0001) {
    return {
      railProgress: 0,
      railVelocity: 0,
      anchor: { ...railStart, dimensionId },
    };
  }

  const railVec = Vector3Utils.subtract(railEnd, railStart);
  const railDir = Vector3Utils.scale(railVec, 1 / railLength);
  const sinTheta = railDir.y;

  const isBraking = jumpPressed && sneakPressed;
  let inputAccel = 0;
  if (!isBraking) {
    if (jumpPressed) inputAccel += config.inputAccel;
    if (sneakPressed) inputAccel -= config.inputAccel;
  }

  const mu = isBraking ? config.brakeFriction : config.friction;
  let v = input.railVelocity;
  const accel = inputAccel - config.railGravity * sinTheta - mu * v;
  v += accel;

  // 最大速度クランプ
  if (v > config.maxRailSpeed) v = config.maxRailSpeed;
  if (v < -config.maxRailSpeed) v = -config.maxRailSpeed;

  // 入力なし＆ほぼ水平で微小速度なら停止へスナップ
  if (
    !jumpPressed &&
    !sneakPressed &&
    Math.abs(sinTheta) < 0.02 &&
    Math.abs(v) < config.stopSpeedThreshold
  ) {
    v = 0;
  }

  // 引っかかり時のアンカー待機:
  // アンカーとプレイヤー胴の距離が上限 (6.0m) を超えた場合、プレイヤーから離れる方向の移動を停止
  const currentPos = Vector3Utils.add(
    railStart,
    Vector3Utils.scale(railDir, input.railProgress),
  );
  const torsoPos: Vector3 = {
    x: playerLocation.x,
    y: playerLocation.y + config.torsoHeightOffset,
    z: playerLocation.z,
  };
  const toAnchor = Vector3Utils.subtract(currentPos, torsoPos);
  const distToTorso = Vector3Utils.magnitude(toAnchor);

  if (distToTorso > config.maxAnchorDistance) {
    // railDir と toAnchor の内積が正なら、+progress 方向がプレイヤーから離れる向き
    const outwardDot = Vector3Utils.dot(railDir, toAnchor);
    if (v * outwardDot > 0) {
      v = 0;
    }
  }

  let nextProgress = input.railProgress + v;
  if (nextProgress <= 0) {
    nextProgress = 0;
    if (v < 0) v = 0;
  } else if (nextProgress >= railLength) {
    nextProgress = railLength;
    if (v > 0) v = 0;
  }

  const nextAnchorPos = Vector3Utils.add(
    railStart,
    Vector3Utils.scale(railDir, nextProgress),
  );

  return {
    railProgress: nextProgress,
    railVelocity: v,
    anchor: {
      x: nextAnchorPos.x,
      y: nextAnchorPos.y,
      z: nextAnchorPos.z,
      dimensionId,
    },
  };
}

export interface ZiplineHookshotOptions {
  baumgarteFactor: number;
  physics: RigidPhysicsConfig;
  steering: RigidSteeringConfig;
  swingPumpAccel: number;
}

/**
 * ジップラインの吊り下げ鎖（足元基準 5.0m = 胴 4.0m）の剛体拘束インパルスを計算します。
 * 視線ステアリングの3D遠心力は使わず、通常の振り子スイング＋エアロベスト加速のみ有効にします。
 */
export function calculateZiplineHookshot(
  player: Player,
  anchor: Vector3,
  ropeLength: number,
  options: ZiplineHookshotOptions,
): Vector3 {
  return calculateRigidHookshot(player, anchor, ropeLength, {
    isReelingIn: false,
    enableSteering: false,
    baumgarteFactor: options.baumgarteFactor,
    physics: options.physics,
    steering: options.steering,
    swingPumpAccel: options.swingPumpAccel,
  });
}
