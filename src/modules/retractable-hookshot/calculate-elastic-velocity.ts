import { Vector3Utils } from "@minecraft/math";
import { Player, Vector3 } from "@minecraft/server";
import {
  calculateVelocityImpulse,
  MINECRAFT_DRAG,
  MINECRAFT_GRAVITY,
} from "addon-utils";
import {
  getDirectionAndDistance,
  predictTickPhysics,
  getNormalComponent,
  clampOutwardVelocity,
} from "../pendulum-calculations.utils";
import { getAirDrag } from "./retractable-hookshot-math.utils";

export interface ElasticRopeParams {
  /** ロープの自然長。これ以下ではたるんで力が働かない */
  naturalLength: number;
  /** ロープの限界長。これを超えると硬い拘束に切り替わる */
  maxLength: number;
  /** バネ定数 (blocks/tick² per block)。大きいほど強く引く。0.2 超は不安定になりやすい */
  stiffness?: number;
  /** 法線方向の減衰率 (0〜1)。大きいほど振動が早く収まる */
  damping?: number;
  /** 1Tickあたりの最大引き込み加速度 (blocks/tick²)。急な伸びでの暴発防止 */
  maxAcceleration?: number;
}

function calculateElasticVelocity(
  player: Player,
  anchor: Vector3,
  {
    naturalLength,
    maxLength,
    stiffness = 0.03,
    damping = 0.01,
    maxAcceleration = 10,
  }: ElasticRopeParams,
): Vector3 | null {
  const { dir: normal, distance: r } = getDirectionAndDistance(
    anchor,
    player.location,
  );
  if (r < 0.0001) return null;

  // たるみ中は自由運動
  if (r <= naturalLength) return null;

  const currentVel = player.getVelocity();
  const speed = Vector3Utils.magnitude(currentVel);

  const vPred = predictTickPhysics({
    velocity: currentVel,
    dragXZ: getAirDrag(speed),
  });

  // --- ゴムの復元力（フックの法則） ---
  const stretch = r - naturalLength;
  const springAccel = Math.min(stiffness * stretch, maxAcceleration);

  // 法線方向の速度に比例した減衰（外向き・内向きどちらにも効かせる）
  const vn = getNormalComponent(vPred, normal);
  const dampingAccel = vn * damping;

  // 内向き(-normal)に加速度を加えた目標速度
  let target = Vector3Utils.subtract(
    vPred,
    Vector3Utils.scale(normal, springAccel + dampingAccel),
  );

  player.sendMessage(`dis: ${r.toFixed(2)}, len: ${naturalLength}`);

  // --- 限界長を超えたら硬い拘束 ---
  const penetration = Math.max(0, r - maxLength);
  if (penetration > 0) {
    const BAUMGARTE_FACTOR = 0.15;
    target = clampOutwardVelocity(
      target,
      normal,
      -penetration * BAUMGARTE_FACTOR,
    );
  }

  return target;
}

export function calculateElasticHookshot(
  player: Player,
  anchor: Vector3,
  params: ElasticRopeParams,
): Vector3 {
  const velocity = calculateElasticVelocity(player, anchor, params);
  if (velocity === null) return { x: 0, y: 0, z: 0 };

  return calculateVelocityImpulse({
    targetVelocity: velocity,
    currentVelocity: player.getVelocity(),
    dragXZ: MINECRAFT_DRAG.air.xz,
    dragY: MINECRAFT_DRAG.air.y,
    gravity: MINECRAFT_GRAVITY,
  });
}
