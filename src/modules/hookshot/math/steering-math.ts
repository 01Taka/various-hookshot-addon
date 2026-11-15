import { Vector3Utils } from "@minecraft/math";
import { Player, Vector3 } from "@minecraft/server";
import { PlayerDirectionResolver } from "addon-utils";
import { PostFlightSystem } from "../../post-flight";

/**
 * 視線・移動入力によるステアリングボーナスが利用可能かを判定します。
 * エアロベスト系チェストプレートを有効な状態（残り耐久 > 1）で装備している場合のみ true を返します。
 */
export function canUseGazeSteering(player: Player): boolean {
  return PostFlightSystem.getEquippedVestInfo(player) !== null;
}

/** 視線・ストレイフによる接線方向ステアリング加速度 (blocks/tick²) */
export const DEFAULT_STEER_ACCEL = 0.085;

/** 回転にまわせるパワーの最大比率（最大60%回転 / 40%巻き取り） */
export const MAX_ROTATION_POWER_RATIO = 0.6;

/** 最大回転パワー（60%）が得られる基準距離 (m) */
export const REFERENCE_SWING_DISTANCE = 30;

/**
 * 距離に応じた回転パワー係数 (0.0 〜 1.0) を取得します。
 * 約30m以内では最大値 1.0（60% 回転 / 40% 巻き取り）。
 * 30mを超えると距離が遠くなるほど回転にまわせるパワーの最大値が低下します。
 */
export function getDistanceRotationFactor(distance: number): number {
  if (distance <= REFERENCE_SWING_DISTANCE) {
    return 1.0;
  }
  return REFERENCE_SWING_DISTANCE / distance;
}

/**
 * プレイヤーの胸の位置を取得します。
 */
export function getPlayerChestLocation(player: Player): Vector3 {
  const pos = player.location;
  return { x: pos.x, y: pos.y + 1.0, z: pos.z };
}

/**
 * 視線とアンカーの角度から、巻き取りパワー配分のための回転比率 (0.0 〜 1.0) を計算します。
 * 角度を 2 倍（2θ）にして評価することで、約 45 度の視線オフセットで最大回転比率 1.0（60% 回転 / 40% 巻き取り）に到達します。
 */
export function calculateGazeRotationRatio(
  lookDir: Vector3,
  toAnchorDir: Vector3,
): number {
  const gazeDot = Math.max(
    -1,
    Math.min(1, Vector3Utils.dot(lookDir, toAnchorDir)),
  );
  const theta = Math.acos(gazeDot); // 0 〜 PI (ラジアン)
  // 角度を2倍し、最大90度 (PI / 2) でクランプ
  const scaledTheta = Math.min(Math.PI / 2, 2 * theta);
  return Math.sin(scaledTheta);
}

/**
 * 視線および移動キー入力から接線ステアリング加速度を計算します。
 *
 * 1. 視線単体による接線インパルス:
 *    視線移動だけでも、巻き取り速度が削れた分（角度2倍で約45度で最大）に比例した接線方向のインパルスを受けます。
 *
 * 2. キー入力による独立した接線インパルス強化:
 *    移動入力の基準となる視線ベクトルは2倍せずそのまま使用し、
 *    入力角度分だけ「画面中央を水平に横切る線（viewRight）と視線の先の線（lookDir）を持つ平面上」で回転させた
 *    合成ベクトル effectiveDir を作成。そのベクトルとアンカーベクトルの内積が小さい（90度に近い）ほど
 *    追加の接線方向の勢いを加算します（巻き取り速度のパワーは奪いません）。
 *
 * 3. 距離減衰:
 *    距離が30mより遠くなるほど回転にまわせるパワーが低下し、接線ステアリング加速度も距離に応じて減衰します。
 */
export function calculateGazeSteeringAcceleration(
  player: Player,
  anchor: Vector3,
  steerAccel = DEFAULT_STEER_ACCEL,
): Vector3 {
  const chest = getPlayerChestLocation(player);
  const diff = Vector3Utils.subtract(anchor, chest);
  const r = Vector3Utils.magnitude(diff);
  if (r < 0.0001) return { x: 0, y: 0, z: 0 };

  const toAnchorDir = Vector3Utils.scale(diff, 1 / r);
  const resolver = PlayerDirectionResolver.get(player);
  const lookDir = resolver.view.vector;

  // 距離に応じた回転パワー係数（30m以内で1.0、遠いほど低下）
  const distFactor = getDistanceRotationFactor(r);
  const effectiveSteerAccel = steerAccel * distFactor;

  // --- 1. 視線移動単体による接線インパルス（巻き取り速度が削れた分、45度で最大比率） ---
  const gazeDot = Vector3Utils.dot(lookDir, toAnchorDir);
  const tangentGaze = Vector3Utils.subtract(
    lookDir,
    Vector3Utils.scale(toAnchorDir, gazeDot),
  );
  const tangentGazeLen = Vector3Utils.magnitude(tangentGaze);
  let totalSteer: Vector3;
  if (tangentGazeLen > 0.0001) {
    const gazeRatio = calculateGazeRotationRatio(lookDir, toAnchorDir);
    const tangentGazeDir = Vector3Utils.scale(tangentGaze, 1 / tangentGazeLen);
    totalSteer = Vector3Utils.scale(
      tangentGazeDir,
      effectiveSteerAccel * gazeRatio,
    );
  } else {
    totalSteer = { x: 0, y: 0, z: 0 };
  }

  // --- 2. キー入力による追加の接線インパルス（※ 基準となる視線方向は2倍せずそのまま使用） ---
  const input = resolver.input;
  const inputLen = Math.hypot(input.vector.x, input.vector.z);
  if (inputLen > 0.05) {
    const rot = player.getRotation();
    const yawRad = (rot.y * Math.PI) / 180;

    // プレイヤーの画面中央を水平に横切る線（カメラローカル右方向、常に lookDir と直交）
    const viewRight = {
      x: -Math.cos(yawRad),
      y: 0,
      z: -Math.sin(yawRad),
    };

    // 入力方向の角度 (W=0, D=+90度, A=-90度, W+D=+45度など)
    const alpha = Math.atan2(input.vector.x, input.vector.z);

    // そのままの視線方向ベクトルを入力角度に応じて画面水平平面上で回転
    const effectiveDir = {
      x: Math.cos(alpha) * lookDir.x + Math.sin(alpha) * viewRight.x,
      y: Math.cos(alpha) * lookDir.y + Math.sin(alpha) * viewRight.y,
      z: Math.cos(alpha) * lookDir.z + Math.sin(alpha) * viewRight.z,
    };

    // このベクトルとアンカーに向かうベクトルの内積が小さい（90度に近い）ほど、より多くの接線方向の勢いを加算
    const effectiveDot = Vector3Utils.dot(effectiveDir, toAnchorDir);
    const tangentInput = Vector3Utils.subtract(
      effectiveDir,
      Vector3Utils.scale(toAnchorDir, effectiveDot),
    );

    const inputMag = Math.min(1.0, inputLen);
    const inputSteer = Vector3Utils.scale(
      tangentInput,
      effectiveSteerAccel * inputMag,
    );
    totalSteer = Vector3Utils.add(totalSteer, inputSteer);
  }

  return totalSteer;
}

/**
 * 視線とアンカーの角度、および距離に基づいてロープ短縮速度の補正倍率を計算します。
 * キー入力は関係なく、巻き取りパワーを奪いません。
 *
 * - 角度を2倍して評価: アンカーから約45度横を向いた時点で最大回転力（60%回転 / 40%巻き取り）に到達
 * - 距離が30m以内: 約45度視線オフセット時に最大値である60%を回転（短縮速度は40%まで低下）
 * - 距離が30mを超える: 遠くなるほど回転にまわせるパワー上限が低下し、直線巻き取りの割合が増加
 * - 視線がアンカー正面を向いている時: 距離に関わらず1.0（全速力で直線引き寄せ）
 *
 * ※ ロープがたるんでいる（slack）間は、まずテンションを張るために 1.0（通常速度）を返します。
 */
export function calculateReelSpeedMultiplier(
  player: Player,
  anchor: Vector3,
  currentLength?: number,
): number {
  const chest = getPlayerChestLocation(player);
  const diff = Vector3Utils.subtract(anchor, chest);
  const r = Vector3Utils.magnitude(diff);
  if (r < 0.0001) return 1.0;

  // ロープがたるんでいる間は通常速度で巻き取る
  if (currentLength !== undefined && r < currentLength - 0.5) {
    return 1.0;
  }

  const toAnchorDir = Vector3Utils.scale(diff, 1 / r);
  const resolver = PlayerDirectionResolver.get(player);
  const lookDir = resolver.view.vector; // 純粋な視線ベクトル（キー入力は影響しない）

  // 角度を2倍にして評価（約45度で最大回転比率 1.0 に到達）
  const gazeRotationalRatio = calculateGazeRotationRatio(lookDir, toAnchorDir);

  // 距離に応じた回転パワー上限（30m以内で最大60%、遠くなるほど低下）
  const distFactor = getDistanceRotationFactor(r);
  const maxRotationRatio = MAX_ROTATION_POWER_RATIO * distFactor;

  // 視線とアンカーの角度のみに基づき短縮速度を減速（最大でも 1.0 - maxRotationRatio までしか低下しない）
  return Math.max(
    1.0 - maxRotationRatio,
    1.0 - gazeRotationalRatio * maxRotationRatio,
  );
}

/**
 * 非巻き取り時の振り子スイング用・接線追加加速度を計算します。
 *
 * 円錐状の旋回（アンカー水平方向と接線速度が直交）での無限加速を防ぐため、
 * 水平面（XZ）上で「アンカー方向」「移動入力方向」「接線速度方向」が平行に近いほど強く効き、
 * 接線方向から離れるほど cos² カーブで滑らかに減衰します。
 */
export function calculatePendulumPumpAcceleration(
  player: Player,
  normal: Vector3,
  velocity: Vector3,
  pumpAccel: number,
): Vector3 {
  if (pumpAccel <= 0) return { x: 0, y: 0, z: 0 };

  const resolver = PlayerDirectionResolver.get(player);
  const input = resolver.input;
  const inputLen = Math.hypot(input.vector.x, input.vector.z);
  if (inputLen <= 0.05) return { x: 0, y: 0, z: 0 };

  // 現在地からアンカーへの水平ベクトル（normal は anchor -> player のため反転）
  const toAnchorX = -normal.x;
  const toAnchorZ = -normal.z;
  const horizDist = Math.hypot(toAnchorX, toAnchorZ);
  if (horizDist < 0.05) return { x: 0, y: 0, z: 0 };

  const toAnchorDirXZ: Vector3 = {
    x: toAnchorX / horizDist,
    y: 0,
    z: toAnchorZ / horizDist,
  };

  // 入力方向をプレイヤーの向き基準でワールド水平方向へ変換
  const rot = player.getRotation();
  const yawRad = (rot.y * Math.PI) / 180;
  const alpha = Math.atan2(input.vector.x, input.vector.z);
  const cosA = Math.cos(alpha);
  const sinA = Math.sin(alpha);
  const inputDirXZ: Vector3 = {
    x: cosA * -Math.sin(yawRad) + sinA * -Math.cos(yawRad),
    y: 0,
    z: cosA * Math.cos(yawRad) + sinA * -Math.sin(yawRad),
  };

  // 静止〜低速時はアンカー水平方向と入力方向の平行度（cos²）で漕ぎ出しを許可
  const cosAnchorInput = Vector3Utils.dot(toAnchorDirXZ, inputDirXZ);
  const standstillFactor = cosAnchorInput * cosAnchorInput;

  // 現在の接線速度の水平成分を取得
  const vn = Vector3Utils.dot(velocity, normal);
  const vtVec = Vector3Utils.subtract(velocity, Vector3Utils.scale(normal, vn));
  const vtHorizLen = Math.hypot(vtVec.x, vtVec.z);

  let alignmentFactor = standstillFactor;
  if (vtHorizLen > 0.0001) {
    const vtDirXZ: Vector3 = {
      x: vtVec.x / vtHorizLen,
      y: 0,
      z: vtVec.z / vtHorizLen,
    };
    const cosAnchorVel = Vector3Utils.dot(toAnchorDirXZ, vtDirXZ);
    const cosInputVel = Math.max(0, Vector3Utils.dot(inputDirXZ, vtDirXZ));
    // 振り子度（cos²φ） × 入力と進行方向の一致度（cos²θ）
    const swingFactor =
      cosAnchorVel * cosAnchorVel * (cosInputVel * cosInputVel);

    // 静止状態からスイング状態へ滑らかにブレンド
    const LOW_SPEED_START = 0.05;
    const LOW_SPEED_END = 0.25;
    const blend = Math.max(
      0,
      Math.min(
        1,
        (vtHorizLen - LOW_SPEED_START) / (LOW_SPEED_END - LOW_SPEED_START),
      ),
    );
    alignmentFactor = standstillFactor * (1 - blend) + swingFactor * blend;
  }

  if (alignmentFactor <= 0.0001) return { x: 0, y: 0, z: 0 };

  // 入力方向をロープの接線平面へ射影し、3D接線方向の推進力を生成
  const inputDotNormal = Vector3Utils.dot(inputDirXZ, normal);
  const tangentPush = Vector3Utils.subtract(
    inputDirXZ,
    Vector3Utils.scale(normal, inputDotNormal),
  );
  const tangentPushLen = Vector3Utils.magnitude(tangentPush);
  if (tangentPushLen < 0.0001) return { x: 0, y: 0, z: 0 };

  const inputMag = Math.min(1.0, inputLen);
  return Vector3Utils.scale(
    tangentPush,
    (pumpAccel * inputMag * alignmentFactor) / tangentPushLen,
  );
}
