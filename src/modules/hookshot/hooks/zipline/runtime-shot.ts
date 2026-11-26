import { Vector3Utils } from "@minecraft/math";
import { Block, Dimension, Player, Vector3 } from "@minecraft/server";
import {
  getDirectionVector,
  isInputButtonPressed,
  isSneakButtonPressed,
} from "addon-utils";
import { HookshotContext } from "../../types";
import { ziplineHookshotConfig } from "./config";
import { ZIPLINE_HOOKSHOT_ID, ZiplineHookshotState } from "./type";

function resolvePillarTopY(
  dimension: Dimension,
  x: number,
  groundY: number,
  z: number,
  pillarHeight: number,
  ceilingClearance: number,
): number {
  let pillarTopY = groundY + pillarHeight;
  const ceilingOriginY = groundY + 0.5;
  const ceilingHit = dimension.getBlockFromRay(
    { x, y: ceilingOriginY, z },
    { x: 0, y: 1, z: 0 },
    {
      maxDistance: Math.max(0.5, pillarHeight - 0.5),
      includeLiquidBlocks: false,
      includePassableBlocks: false,
    },
  );
  if (ceilingHit) {
    const ceilNormal = getDirectionVector(ceilingHit.face);
    const ceilingY = ceilingHit.block.y + 0.5 + ceilNormal.y * 0.5;
    pillarTopY = Math.max(
      groundY + 0.5,
      Math.min(pillarTopY, ceilingY - ceilingClearance),
    );
  }
  return pillarTopY;
}

export function shotZipline(player: Player, ctx: HookshotContext): boolean {
  const def = ziplineHookshotConfig;
  const loc = player.location;
  const { halfWidth, maxDownDistance, pillarHeight, ceilingClearance } =
    def.groundCheck;

  const offsets = [
    { dx: -halfWidth, dz: -halfWidth },
    { dx: halfWidth, dz: -halfWidth },
    { dx: -halfWidth, dz: halfWidth },
    { dx: halfWidth, dz: halfWidth },
  ];

  const rayOptions = {
    maxDistance: maxDownDistance + 0.2,
    includeLiquidBlocks: false,
    includePassableBlocks: false,
  };

  const groundHits: { block: Block; surfaceY: number; distSq: number }[] = [];
  for (const { dx, dz } of offsets) {
    const origin: Vector3 = {
      x: loc.x + dx,
      y: loc.y + 0.2,
      z: loc.z + dz,
    };
    const downHit = player.dimension.getBlockFromRay(
      origin,
      { x: 0, y: -1, z: 0 },
      rayOptions,
    );
    if (downHit) {
      const hitNormal = getDirectionVector(downHit.face);
      const surfaceY = downHit.block.y + 0.5 + hitNormal.y * 0.5;
      const cx = downHit.block.x + 0.5;
      const cz = downHit.block.z + 0.5;
      const distSq = (cx - loc.x) * (cx - loc.x) + (cz - loc.z) * (cz - loc.z);
      groundHits.push({ block: downHit.block, surfaceY, distSq });
    }
  }

  if (groundHits.length === 0) {
    ctx.playSound(player, def.missSoundId);
    return false;
  }

  const maxGroundY = Math.max(...groundHits.map((h) => h.surfaceY));
  const bestStartHit = groundHits
    .filter((h) => Math.abs(h.surfaceY - maxGroundY) < 0.001)
    .reduce((best, cur) => (cur.distSq < best.distSq ? cur : best));

  const startPillarX = bestStartHit.block.x + 0.5;
  const startPillarZ = bestStartHit.block.z + 0.5;
  const startPillarTopY = resolvePillarTopY(
    player.dimension,
    startPillarX,
    maxGroundY,
    startPillarZ,
    pillarHeight,
    ceilingClearance,
  );

  const hit = player.getBlockFromViewDirection({
    maxDistance: def.maxDistance,
    includeLiquidBlocks: false,
    includePassableBlocks: false,
  });
  if (!hit) {
    ctx.playSound(player, def.missSoundId);
    return false;
  }

  const normal = getDirectionVector(hit.face);
  const hitFaceCenter: Vector3 = {
    x: hit.block.x + 0.5 + normal.x * 0.5,
    y: hit.block.y + 0.5 + normal.y * 0.5,
    z: hit.block.z + 0.5 + normal.z * 0.5,
  };

  let endRailBase: Vector3 | undefined;
  let endRailTop: Vector3 | undefined;
  let railEnd: Vector3;
  let endSupportBlock: Vector3;

  const endDownHit =
    normal.y >= -0.2
      ? player.dimension.getBlockFromRay(
          Vector3Utils.add(hitFaceCenter, Vector3Utils.scale(normal, 0.5)),
          { x: 0, y: -1, z: 0 },
          {
            maxDistance: maxDownDistance + 0.5,
            includeLiquidBlocks: false,
            includePassableBlocks: false,
          },
        )
      : undefined;

  if (endDownHit) {
    const endGroundNormal = getDirectionVector(endDownHit.face);
    const endGroundY = endDownHit.block.y + 0.5 + endGroundNormal.y * 0.5;
    const endPillarX = endDownHit.block.x + 0.5;
    const endPillarZ = endDownHit.block.z + 0.5;
    const endPillarTopY = resolvePillarTopY(
      player.dimension,
      endPillarX,
      endGroundY,
      endPillarZ,
      pillarHeight,
      ceilingClearance,
    );
    endRailBase = { x: endPillarX, y: endGroundY, z: endPillarZ };
    railEnd = { x: endPillarX, y: endPillarTopY, z: endPillarZ };
    endSupportBlock = {
      x: endDownHit.block.x,
      y: endDownHit.block.y,
      z: endDownHit.block.z,
    };
  } else {
    endRailBase = hitFaceCenter;
    endRailTop = Vector3Utils.add(
      hitFaceCenter,
      Vector3Utils.scale(normal, 0.5),
    );
    railEnd = Vector3Utils.add(
      hitFaceCenter,
      Vector3Utils.scale(normal, def.groundCheck.endNormalOffset),
    );
    endSupportBlock = {
      x: hit.block.x,
      y: hit.block.y,
      z: hit.block.z,
    };
  }

  const railBase: Vector3 = {
    x: startPillarX,
    y: maxGroundY,
    z: startPillarZ,
  };
  const railStart: Vector3 = {
    x: startPillarX,
    y: startPillarTopY,
    z: startPillarZ,
  };
  const startSupportBlock: Vector3 = {
    x: bestStartHit.block.x,
    y: bestStartHit.block.y,
    z: bestStartHit.block.z,
  };
  const railLength = Vector3Utils.distance(railStart, railEnd);

  if (railLength < def.groundCheck.minRailLength) {
    ctx.playSound(player, def.missSoundId);
    return false;
  }

  const jumpConsumed = isInputButtonPressed(player, "Jump") || player.isJumping;
  const sneakConsumed = isSneakButtonPressed(player);

  const state: ZiplineHookshotState = {
    hookshotId: ZIPLINE_HOOKSHOT_ID,
    slotIndex: player.selectedSlotIndex,
    anchor: {
      x: railStart.x,
      y: railStart.y,
      z: railStart.z,
      dimensionId: player.dimension.id,
    },
    normal,
    currentLength:
      !jumpConsumed && !sneakConsumed
        ? def.hangingRopeLength + def.idleSlackOffset
        : def.hangingRopeLength - def.activePullOffset,
    jumpConsumed,
    sneakConsumed,
    railBase,
    endRailBase,
    endRailTop,
    railStart,
    railEnd,
    startSupportBlock,
    endSupportBlock,
    railLength,
    railProgress: 0,
    railVelocity: 0,
    facingDirectionSign: 1,
  };

  ctx.setActiveState(player, state);
  ctx.playSound(player, def.shotSoundId);
  ctx.playSound(player, def.hitSoundId);
  return true;
}
