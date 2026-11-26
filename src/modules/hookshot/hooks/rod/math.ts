import { Vector3Utils } from "@minecraft/math";
import { Player, Vector3 } from "@minecraft/server";
import { EPSILON } from "../../constants";
import {
  convertTargetVelocityToImpulse,
  getAirDrag,
  getDirectionAndDistance,
  getNormalComponent,
  predictTickPhysics,
} from "../../math/physics-utils";

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

  const vPred = predictTickPhysics({
    velocity: currentVel,
    dragXZ: getAirDrag(speed),
  });

  const vn = getNormalComponent(vPred, normal);
  const vt = Vector3Utils.subtract(vPred, Vector3Utils.scale(normal, vn));

  const error = r - rodLength;
  const targetRadialSpeed = -error * baumgarteFactor;

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
