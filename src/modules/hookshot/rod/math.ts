import { Vector3Utils } from "@minecraft/math";
import { Player, Vector3 } from "@minecraft/server";
import { EPSILON } from "../constants";
import {
  convertTargetVelocityToImpulse,
  getAirDrag,
  getDirectionAndDistance,
  getNormalComponent,
  predictTickPhysics,
} from "../math/physics-utils";

/**
 * 完全な剛体棒（双方向拘束）に基づき、
 * 内側にも外側にも縮まない・伸びない目標速度を計算します。
 */
export function calculateRodVelocity(
  player: Player,
  anchor: Vector3,
  rodLength: number,
  baumgarteFactor: number,
): Vector3 | null {
  const { dir: normal, distance: r } = getDirectionAndDistance(
    anchor,
    player.location,
  );
  if (r < EPSILON) return null;

  const currentVel = player.getVelocity();
  const speed = Vector3Utils.magnitude(currentVel);

  // 1. 次Tickの自由予測速度（動的空気抵抗適用）
  const vPred = predictTickPhysics({
    velocity: currentVel,
    dragXZ: getAirDrag(speed),
  });

  // 2. 予測速度を「法線（動径）成分」と「接線（円周）成分」に分解
  const vn = getNormalComponent(vPred, normal);
  const vt = Vector3Utils.subtract(vPred, Vector3Utils.scale(normal, vn));

  // 3. 剛体ロッドの位置誤差補正（双方向Baumgarte安定化）
  // 外側にはみ出ている (r > rodLength) 場合は内側へ引き戻し、
  // 内側に入り込んでいる (r < rodLength) 場合は外側へ押し戻す
  const error = r - rodLength;
  const targetRadialSpeed = -error * baumgarteFactor;

  // 4. 接線速度（スイング運動）に、位置誤差補正の法線速度を合成して目標速度とする
  const targetVelocity = Vector3Utils.add(
    vt,
    Vector3Utils.scale(normal, targetRadialSpeed),
  );

  return targetVelocity;
}

export function calculateRodHookshot(
  player: Player,
  anchor: Vector3,
  rodLength: number,
  baumgarteFactor: number,
): Vector3 {
  const velocity = calculateRodVelocity(
    player,
    anchor,
    rodLength,
    baumgarteFactor,
  );
  return convertTargetVelocityToImpulse(player, velocity);
}
