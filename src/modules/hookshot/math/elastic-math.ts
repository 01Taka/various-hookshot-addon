import { Vector3Utils } from "@minecraft/math";
import { Player, Vector3 } from "@minecraft/server";
import { PlayerDirectionResolver } from "addon-utils";
import {
  clampOutwardVelocity,
  convertTargetVelocityToImpulse,
  getAirDrag,
  getDirectionAndDistance,
  getNormalComponent,
  predictTickPhysics,
} from "./physics-utils";
import { MAX_HOOKSHOT_SPEED } from "./steering-math";

export interface ElasticRopeParams {
  /** ロープの自然長。これ以下ではたるんで力が働かない */
  naturalLength: number;
  /** ロープの限界長。これを超えると硬い拘束に切り替わる */
  maxLength?: number;
  /** バネ定数（解放時のフォールバック用） */
  stiffness?: number;
  /** チャージ中（isReelingIn=true）の基本バネ定数。小さいほど移動せず張力が溜まりやすい */
  chargeStiffness?: number;
  /** 解放時（isReelingIn=false）のバネ定数。大きいほど一気に弾け飛ぶ */
  releaseStiffness?: number;
  /** 解放時の法線方向減衰率 (0〜1) */
  damping?: number;
  /** チャージ中の法線方向減衰率 (0〜1)。巻き取り速度との収束点を決める */
  chargeDamping?: number;
  /** 1Tickあたりの最大引き込み加速度 (blocks/tick²)。急な伸びでの暴発防止 */
  maxAcceleration?: number;
  /** 解放時の最高速度上限 (blocks/tick) */
  releaseMaxSpeed?: number;
  /** 空中ジャンプ入力によって現在チャージ（巻き取り）中かどうか */
  isReelingIn?: boolean;
  /** チャージ解放による高速射出中かどうか */
  isChargeReleasing?: boolean;
  /** エアロベスト装備時の前後移動入力によるチャージ/巻き取り配分を有効にするかどうか */
  enableInputChargeControl?: boolean;
}

/**
 * エアロベスト装備時の前後入力（W/S）に応じたチャージ中バネ定数の倍率を計算します。
 * - 前入力 (W, z > 0): 引っ張り力を強めて巻き取り移動を優先（チャージは遅くなる）
 * - 後入力 (S, z < 0): 引っ張り力を弱めてチャージの蓄積を優先
 */
function getChargeStiffnessMultiplier(player: Player): number {
  const inputZ = PlayerDirectionResolver.get(player).input.vector.z;
  if (inputZ > 0.05) {
    return 1.0 + Math.min(1.0, inputZ) * 1.2;
  }
  if (inputZ < -0.05) {
    return Math.max(0.35, 1.0 + Math.max(-1.0, inputZ) * 0.65);
  }
  return 1.0;
}

export function calculateElasticVelocity(
  player: Player,
  anchor: Vector3,
  {
    naturalLength,
    maxLength,
    stiffness,
    chargeStiffness = 0.003,
    releaseStiffness = 0.14,
    damping = 0.01,
    chargeDamping = 0.085,
    maxAcceleration = 1.35,
    releaseMaxSpeed = 3.3,
    isReelingIn,
    isChargeReleasing,
    enableInputChargeControl,
  }: ElasticRopeParams,
): Vector3 | null {
  const { dir: normal, distance: r } = getDirectionAndDistance(
    anchor,
    player.location,
  );
  if (r < 0.0001) return null;

  // たるみ中は自由運動（テンション発生時のみ作動）
  if (r <= naturalLength) return null;

  const currentVel = player.getVelocity();
  const speed = Vector3Utils.magnitude(currentVel);
  const isCharging = !!isReelingIn;
  const isLaunching = !isCharging && !!isChargeReleasing;

  // チャージ解放による射出中のみ動的空気抵抗を解除し、0.99 固定にする
  const vPred = predictTickPhysics({
    velocity: currentVel,
    dragXZ: isLaunching ? 0.99 : getAirDrag(speed),
  });

  // --- チャージ中 / 解放時で復元力・減衰を切り替え ---
  let activeStiffness = isCharging
    ? chargeStiffness
    : (stiffness ?? releaseStiffness);
  if (isCharging && enableInputChargeControl) {
    activeStiffness *= getChargeStiffnessMultiplier(player);
  }
  const activeDamping = isCharging ? chargeDamping : damping;

  // --- ゴムの復元力（フックの法則） ---
  const stretch = r - naturalLength;
  const springAccel = Math.min(activeStiffness * stretch, maxAcceleration);

  // 法線方向の速度に比例した減衰（外向き・内向きどちらにも効かせる）
  const vn = getNormalComponent(vPred, normal);
  const dampingAccel = vn * activeDamping;

  // 内向き(-normal)に加速度を加えた目標速度
  let target = Vector3Utils.subtract(
    vPred,
    Vector3Utils.scale(normal, springAccel + dampingAccel),
  );

  // --- 限界長を超えたら硬い拘束 ---
  if (maxLength) {
    const penetration = Math.max(0, r - maxLength);
    if (penetration > 0) {
      const BAUMGARTE_FACTOR = 0.15;
      target = clampOutwardVelocity(
        target,
        normal,
        -penetration * BAUMGARTE_FACTOR,
      );
    }
  }

  // 最高速度上限クランプ（チャージ解放射出中のみ上限を引き上げる）
  const speedLimit = isLaunching ? releaseMaxSpeed : MAX_HOOKSHOT_SPEED;
  const targetSpeed = Vector3Utils.magnitude(target);
  if (targetSpeed > speedLimit) {
    target = Vector3Utils.scale(target, speedLimit / targetSpeed);
  }

  return target;
}

export function calculateElasticHookshot(
  player: Player,
  anchor: Vector3,
  params: ElasticRopeParams,
): Vector3 {
  const velocity = calculateElasticVelocity(player, anchor, params);
  return convertTargetVelocityToImpulse(player, velocity);
}
