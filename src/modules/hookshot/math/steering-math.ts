import { Vector3Utils } from "@minecraft/math";
import { Player, Vector3 } from "@minecraft/server";
import { PlayerDirectionResolver } from "addon-utils";

/** 視線・ストレイフによる接線方向ステアリング加速度 (blocks/tick²) */
export const DEFAULT_STEER_ACCEL = 0.085;

/** フックショットスイングの最高速度上限 (blocks/tick ≈ 33 m/s) */
export const MAX_HOOKSHOT_SPEED = 1.65;

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
 * 視線および移動キー入力から接線ステアリング加速度を計算します。
 *
 * 1. 視線単体による接線インパルス:
 *    視線移動だけでも、巻き取り速度が削れた分（視線とアンカーの直交度合い）に比例した接線方向のインパルスを受けます。
 *
 * 2. キー入力による独立した接線インパルス強化:
 *    視線ベクトルを入力角度分だけ「画面中央を水平に横切る線（viewRight）と視線の先の線（lookDir）を持つ平面上」で回転させた
 *    合成ベクトル effectiveDir を作成し、そのベクトルとアンカーベクトルの内積が小さい（90度に近い）ほど
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

  // --- 1. 視線移動単体による接線インパルス（巻き取り速度が削れた分） ---
  const gazeDot = Vector3Utils.dot(lookDir, toAnchorDir);
  const tangentGaze = Vector3Utils.subtract(
    lookDir,
    Vector3Utils.scale(toAnchorDir, gazeDot),
  );
  let totalSteer = Vector3Utils.scale(tangentGaze, effectiveSteerAccel);

  // --- 2. キー入力による追加の接線インパルス（視線ベクトルを入力に応じて平面上で回転） ---
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

    // 視線方向のベクトルを入力角度に応じて画面水平平面上で回転
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
 * - 距離が30m以内: 90度直交時に最大値である60%を回転（短縮速度は40%まで低下）
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

  const gazeDot = Vector3Utils.dot(lookDir, toAnchorDir);
  // 視線とアンカーの直交度合い sin(theta) = sqrt(1 - cos^2)
  const gazeRotationalRatio = Math.sqrt(Math.max(0, 1 - gazeDot * gazeDot));

  // 距離に応じた回転パワー上限（30m以内で最大60%、遠くなるほど低下）
  const distFactor = getDistanceRotationFactor(r);
  const maxRotationRatio = MAX_ROTATION_POWER_RATIO * distFactor;

  // 視線とアンカーの角度のみに基づき短縮速度を減速（最大でも 1.0 - maxRotationRatio までしか低下しない）
  return Math.max(
    1.0 - maxRotationRatio,
    1.0 - gazeRotationalRatio * maxRotationRatio,
  );
}
