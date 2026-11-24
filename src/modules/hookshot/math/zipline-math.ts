import { Vector3Utils } from "@minecraft/math";
import { Player, Vector3 } from "@minecraft/server";
import { convertTargetVelocityToImpulse } from "./physics-utils";
import { calculateRigidVelocity, RigidPhysicsConfig } from "./rigid-math";
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
  /** 地面踏ん張り判定で鎖が張ったとみなす胴〜アンカー距離 (blocks, デフォルト: 3.9) */
  tautChainLength: number;
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
  isOnGround: boolean;
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
    isOnGround,
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
  const outwardDot = Vector3Utils.dot(railDir, toAnchor);

  // 地上踏ん張り: 地面に立っており無入力（自動滑走・惰性のみ）で鎖が張った状態なら、
  // プレイヤーから離れる向きのアンカー移動を停止する
  if (
    isOnGround &&
    !jumpPressed &&
    !sneakPressed &&
    distToTorso >= config.tautChainLength &&
    v * outwardDot > 0
  ) {
    v = 0;
  }

  if (distToTorso > config.maxAnchorDistance) {
    // railDir と toAnchor の内積が正なら、+progress 方向がプレイヤーから離れる向き
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
  /** レール方向（始点→終点）の単位ベクトル */
  railDir: Vector3;
  /** アンカーの現在速度ベクトル (blocks/tick) */
  anchorVelocity: Vector3;
  /** レール平行方向（前後揺れ）のダンピング率 (0.0〜1.0, デフォルト: 0.14) */
  parallelDamping?: number;
  /** レール垂直方向（左右スイング）のダンピング率 (0.0〜1.0, デフォルト: 0.02) */
  lateralDamping?: number;
}

/**
 * ジップラインの吊り下げ鎖（足元基準 5.0m = 胴 4.0m）の剛体拘束インパルスを計算します。
 * 視線ステアリングの3D遠心力は使わず、通常の振り子スイング＋エアロベスト加速と
 * レール平行方向（強め）／垂直方向（弱め）の分離ダンピングを適用します。
 */
export function calculateZiplineHookshot(
  player: Player,
  anchor: Vector3,
  ropeLength: number,
  options: ZiplineHookshotOptions,
): Vector3 {
  const targetVelocity = calculateRigidVelocity(player, anchor, ropeLength, {
    isReelingIn: false,
    enableSteering: false,
    baumgarteFactor: options.baumgarteFactor,
    physics: options.physics,
    steering: options.steering,
    swingPumpAccel: options.swingPumpAccel,
  });

  if (!targetVelocity) {
    return { x: 0, y: 0, z: 0 };
  }

  const parallelDamping = options.parallelDamping ?? 0.14;
  const lateralDamping = options.lateralDamping ?? 0.02;
  if ((parallelDamping > 0 || lateralDamping > 0) && !player.isOnGround) {
    const relX = targetVelocity.x - options.anchorVelocity.x;
    const relZ = targetVelocity.z - options.anchorVelocity.z;
    const horizLen = Math.hypot(options.railDir.x, options.railDir.z);

    if (horizLen > 0.0001) {
      const dx = options.railDir.x / horizLen;
      const dz = options.railDir.z / horizLen;
      const relAlong = relX * dx + relZ * dz;
      const alongX = dx * relAlong;
      const alongZ = dz * relAlong;
      const perpX = relX - alongX;
      const perpZ = relZ - alongZ;

      return convertTargetVelocityToImpulse(player, {
        x:
          options.anchorVelocity.x +
          alongX * (1 - parallelDamping) +
          perpX * (1 - lateralDamping),
        y: targetVelocity.y,
        z:
          options.anchorVelocity.z +
          alongZ * (1 - parallelDamping) +
          perpZ * (1 - lateralDamping),
      });
    }

    return convertTargetVelocityToImpulse(player, {
      x: targetVelocity.x - relX * parallelDamping,
      y: targetVelocity.y,
      z: targetVelocity.z - relZ * parallelDamping,
    });
  }

  return convertTargetVelocityToImpulse(player, targetVelocity);
}
