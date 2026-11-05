import { Vector3Utils } from "@minecraft/math";
import { Player, Vector3 } from "@minecraft/server";
import {
  convertTargetVelocityToImpulse,
  getAirDrag,
  getDirectionAndDistance,
  getNormalComponent,
  predictTickPhysics,
} from "./physics-utils";

export interface BambooVaultParams {
  /** ポールの自然長（アンカー接続時の距離） */
  naturalLength: number;
  /** 圧縮時の反発バネ定数（縮むほど強力に外側へ押し出す） */
  compressionStiffness?: number;
  /** 引っ張られた時の引力バネ定数（自然長を超えた時に戻す力） */
  tensionStiffness?: number;
  /** 動径方向の速度減衰率 (0〜1) */
  damping?: number;
  /** 水平助走速度としなりから上方跳躍へ変換する自然なリフト係数 */
  liftFactor?: number;
  /** 着弾面の法線ベクトル（地面めり込み防止用） */
  surfaceNormal?: Vector3;
  /** 1Tickあたりの最大加速度 */
  maxAcceleration?: number;
}

/**
 * しなる弾性支柱（竹ポール・棒高跳びモデル）に基づき、
 * 助走の水平慣性をしなり反発と自然な上方リフトに変換する目標速度を計算します。
 */
export function calculateBambooVaultVelocity(
  player: Player,
  anchor: Vector3,
  {
    naturalLength,
    compressionStiffness = 0.09,
    tensionStiffness = 0.035,
    damping = 0.012,
    liftFactor = 0.05,
    surfaceNormal,
    maxAcceleration = 10,
  }: BambooVaultParams,
): Vector3 | null {
  const { dir: normal, distance: r } = getDirectionAndDistance(
    anchor,
    player.location,
  );
  if (r < 0.0001) return null;

  const currentVel = player.getVelocity();
  const speed = Vector3Utils.magnitude(currentVel);

  // 1. 次Tickの自由予測速度（空気抵抗適用）
  const vPred = predictTickPhysics({
    velocity: currentVel,
    dragXZ: getAirDrag(speed),
  });

  const stretch = r - naturalLength;
  const vn = getNormalComponent(vPred, normal);

  // 2. しなる支柱の動径方向バネ力
  // stretch < 0 (圧縮・接近): 外向き(+normal)に強力に押し出す斥力
  // stretch > 0 (伸長・離反): 内向き(-normal)に引き寄せる張力
  let springAccel: number;
  if (stretch < 0) {
    const compression = -stretch;
    const clampedComp = Math.min(
      compression * compressionStiffness,
      maxAcceleration,
    );
    // 外向き反発加速度
    springAccel = -clampedComp;
  } else {
    const clampedTension = Math.min(
      stretch * tensionStiffness,
      maxAcceleration,
    );
    // 内向き引力加速度
    springAccel = clampedTension;
  }

  // 動径方向の速度に対する減衰
  const dampingAccel = vn * damping;
  const totalRadialAccel = springAccel + dampingAccel;

  // 動径加速度を適用（totalRadialAccel が負の場合は +normal 方向へ加速）
  let target = Vector3Utils.subtract(
    vPred,
    Vector3Utils.scale(normal, totalRadialAccel),
  );

  // 3. 棒高跳びの自然な上方リフト変換（圧縮時のみ動作）
  if (stretch < 0) {
    const compression = -stretch;
    const horizontalSpeed = Math.hypot(vPred.x, vPred.z);

    // 圧縮中に地面へ落ち込もうとする下向き速度を自然に緩和（ポールの支持力）
    if (target.y < 0) {
      const supportFactor = Math.min(compression * 0.25, 0.85);
      target = {
        x: target.x,
        y: target.y * (1 - supportFactor),
        z: target.z,
      };
    }

    // 助走の水平慣性としなり量に応じて、ポールが立ち上がる自然な上方跳躍リフトを加算
    // プレイヤーがアンカーより低い位置やアンカー高さ付近にいる時に特に強く働く
    const heightRelAnchor = player.location.y - anchor.y;
    if (heightRelAnchor < naturalLength * 1.2) {
      const lift = Math.min(
        compression * liftFactor * (1.0 + horizontalSpeed * 1.8),
        0.38,
      );
      target = {
        x: target.x,
        y: target.y + lift,
        z: target.z,
      };
    }
  }

  // 4. 着弾面（地面など）へのめり込み防止・接地摩擦アシスト
  if (surfaceNormal) {
    const rVec = Vector3Utils.subtract(player.location, anchor);
    const s = Vector3Utils.dot(rVec, surfaceNormal);
    // 地面近接（s < 0.3）時に法線方向へ滑らかに逃がす
    if (s < 0.3) {
      const push = Math.min((0.3 - s) * 0.15, 0.4);
      target = Vector3Utils.add(
        target,
        Vector3Utils.scale(surfaceNormal, push),
      );
    }
  }

  return target;
}

export function calculateBambooVaultHookshot(
  player: Player,
  anchor: Vector3,
  params: BambooVaultParams,
): Vector3 {
  const velocity = calculateBambooVaultVelocity(player, anchor, params);
  return convertTargetVelocityToImpulse(player, velocity);
}
