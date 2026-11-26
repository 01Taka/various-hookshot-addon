import { Vector3Utils } from "@minecraft/math";
import { Block, Dimension, Player, system, Vector3 } from "@minecraft/server";
import {
  getDirectionVector,
  isInputButtonPressed,
  isSneakButtonPressed,
} from "addon-utils";
import { HookRenderManager, ZIPLINE_WIRE_STYLE } from "../../render";
import { canUseGazeSteering } from "../math/steering-math";
import { HookshotContext } from "../types";
import { calculateZiplineHookshot, stepZiplineRailAnchor } from "./math";
import {
  ZIPLINE_HOOKSHOT_ID,
  ZiplineHookshotDefinition,
  ZiplineHookshotState,
} from "./type";

export const ZIPLINE_ITEM_ID = "various_hookshot_addon:zipline_hookshot";

export const ziplineHookshotDefinition: ZiplineHookshotDefinition = {
  id: ZIPLINE_HOOKSHOT_ID,
  itemTypeId: ZIPLINE_ITEM_ID,
  maxDistance: 300,
  hangingRopeLength: 5.0,
  idleSlackOffset: 0.3,
  activePullOffset: 0.3,
  visualChainLength: 4.0,
  baumgarteFactor: 0.42,
  groundCheck: {
    halfWidth: 0.5,
    maxDownDistance: 5.0,
    pillarHeight: 5.0,
    ceilingClearance: 0.3,
    endNormalOffset: 1.0,
    minRailLength: 3.0,
  },
  shotSoundId: "crossbow.shoot",
  hitSoundId: "place.chain",
  missSoundId: "dig.chain",
  detachSoundId: "dig.chain",
  slideSound: {
    soundId: "step.chain",
    intervalTicks: 4,
    minSpeed: 0.15,
  },
  fallProtection: {
    minAnchorVelY: -0.4,
    minPlayerVelY: -0.45,
    requiredConsecutiveTicks: 5,
    cooldownTicks: 16,
  },
  wireStyle: ZIPLINE_WIRE_STYLE,
  railPhysics: {
    inputAccel: 0.104,
    railGravity: 0.092,
    friction: 0.06,
    brakeFriction: 0.2,
    maxRailSpeed: 2.2,
    maxAnchorDistance: 6.0,
    tautChainLength: 3.9,
    torsoHeightOffset: 1.0,
    stopSpeedThreshold: 0.005,
  },
  physics: {
    tautMargin: 0.25,
    innerSwingMargin: 2.0,
    innerBaumgarteFactor: 0.08,
    inwardEscapeThreshold: 0.45,
    maxSteeringSpeed: 2.2,
    swingPumpAccelNormal: 0.015,
    swingPumpAccelVest: 0.04,
  },
  steering: {
    steerAccel: 0.065,
    referenceSwingDistance: 30,
    fullSteerAngleDeg: 45,
    steerFadeStartDeg: 90,
    steerFadeEndDeg: 110,
    adPriorityAngleDeg: 30,
    centrifugal3DReferenceAccel: 0.14,
    maxUpwardTiltDeg: 45,
    tiltFullElevationDeg: 30,
    tiltHalfDistance: 20,
    tiltFullDistance: 12,
    tiltRatePerTick: 0.25,
    aboveAnchorDecayTicks: 20,
    centrifugalReferenceAccel: 0.28,
    reelCentrifugalHorizWeight: 1.0,
    reelCentrifugalVertWeight: 0.3,
    centrifugalMinRadius: 8.0,
    minReelSpeedMultiplier: 0.25,
    slackDeadzone: 0.5,
    pumpLowSpeedStart: 0.05,
    pumpLowSpeedEnd: 0.25,
  },
  calculateImpulse: (player, state) => {
    const hasVest = canUseGazeSteering(player);
    const { physics, steering, baumgarteFactor } = ziplineHookshotDefinition;
    const railDir =
      state.railLength > 0.0001
        ? Vector3Utils.scale(
            Vector3Utils.subtract(state.railEnd, state.railStart),
            1 / state.railLength,
          )
        : { x: 0, y: 0, z: 1 };
    const anchorVelocity =
      state.railVelocity !== 0
        ? Vector3Utils.scale(railDir, state.railVelocity)
        : { x: 0, y: 0, z: 0 };

    let isPropelling = false;
    try {
      isPropelling =
        isInputButtonPressed(player, "Jump") ||
        player.isJumping ||
        isSneakButtonPressed(player);
    } catch {
      isPropelling = false;
    }

    return calculateZiplineHookshot(player, state.anchor, state.currentLength, {
      baumgarteFactor: baumgarteFactor ?? 0.42,
      physics,
      steering,
      swingPumpAccel: hasVest
        ? physics.swingPumpAccelVest
        : physics.swingPumpAccelNormal,
      railDir,
      anchorVelocity,
      parallelDamping: 0.14,
      lateralDamping: 0.02,
      suppressParallelSwing: isPropelling,
    });
  },
  customShot: (player, ctx) =>
    shotZipline(player, ziplineHookshotDefinition, ctx),
  onTick: (player, state, _info, ctx) => {
    if (
      isSupportBlockBroken(player.dimension, state.startSupportBlock) ||
      isSupportBlockBroken(player.dimension, state.endSupportBlock)
    ) {
      ctx.unhook(player);
      return false;
    }
    updateZiplineAnchor(player, state, ziplineHookshotDefinition, ctx);
  },
  render: (player, state) => {
    HookRenderManager.renderZipline(player, {
      railBase: state.railBase,
      endRailBase: state.endRailBase,
      endRailTop: state.endRailTop,
      railStart: state.railStart,
      railEnd: state.railEnd,
      startSupportBlock: state.startSupportBlock,
      endSupportBlock: state.endSupportBlock,
      anchor: state.anchor,
      visualChainLength: Math.max(
        0.5,
        state.currentLength -
          ziplineHookshotDefinition.railPhysics.torsoHeightOffset,
      ),
      torsoHeightOffset:
        ziplineHookshotDefinition.railPhysics.torsoHeightOffset,
      chainStyle: ziplineHookshotDefinition.wireStyle,
    });
  },
};

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

function isSupportBlockBroken(
  dimension: Dimension,
  blockPos: Vector3,
): boolean {
  try {
    const block = dimension.getBlock(blockPos);
    if (!block) return false;
    return block.isAir || block.isLiquid;
  } catch {
    return false;
  }
}

function shotZipline(
  player: Player,
  def: ZiplineHookshotDefinition,
  ctx: HookshotContext,
): boolean {
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
    hookshotId: "zipline",
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

function updateZiplineAnchor(
  player: Player,
  state: ZiplineHookshotState,
  def: ZiplineHookshotDefinition,
  ctx: HookshotContext,
): void {
  if (!player.isValid) return;

  let jumpPressed = false;
  let sneakPressed = false;
  try {
    jumpPressed = isInputButtonPressed(player, "Jump") || player.isJumping;
    sneakPressed = isSneakButtonPressed(player);
  } catch {
    return;
  }

  let facingSign: 1 | -1 = state.facingDirectionSign ?? 1;
  if (!jumpPressed && !sneakPressed && state.railLength > 0.0001) {
    try {
      const viewDir = player.getViewDirection();
      const horizViewLen = Math.hypot(viewDir.x, viewDir.z);
      if (horizViewLen >= 0.35) {
        const railDir = Vector3Utils.scale(
          Vector3Utils.subtract(state.railEnd, state.railStart),
          1 / state.railLength,
        );
        const horizRailLen = Math.hypot(railDir.x, railDir.z);
        const dirDot =
          horizRailLen >= 0.2
            ? (viewDir.x * railDir.x + viewDir.z * railDir.z) /
              (horizViewLen * horizRailLen)
            : Vector3Utils.dot(viewDir, railDir);
        if (dirDot >= 0.2) {
          facingSign = 1;
        } else if (dirDot <= -0.2) {
          facingSign = -1;
        }
      }
    } catch {}
  }
  state.facingDirectionSign = facingSign;

  const result = stepZiplineRailAnchor({
    railStart: state.railStart,
    railEnd: state.railEnd,
    railLength: state.railLength,
    railProgress: state.railProgress,
    railVelocity: state.railVelocity,
    dimensionId: state.anchor.dimensionId,
    jumpPressed,
    sneakPressed,
    inputDirectionSign: facingSign,
    isOnGround: player.isOnGround,
    playerLocation: player.location,
    config: def.railPhysics,
  });

  state.railProgress = result.railProgress;
  state.railVelocity = result.railVelocity;
  state.anchor = result.anchor;
  state.currentLength =
    !jumpPressed && !sneakPressed
      ? def.hangingRopeLength + def.idleSlackOffset
      : def.hangingRopeLength - def.activePullOffset;

  const absSpeed = Math.abs(state.railVelocity);
  if (absSpeed >= def.slideSound.minSpeed) {
    const lastTick = state.lastSlideSoundTick ?? -def.slideSound.intervalTicks;
    if (system.currentTick - lastTick >= def.slideSound.intervalTicks) {
      const pitch = 0.85 + Math.min(0.6, absSpeed * 0.28);
      ctx.playSound(player, def.slideSound.soundId, pitch);
      state.lastSlideSoundTick = system.currentTick;
    }
  }

  updateZiplineFallProtection(player, state, def);

  ctx.setActiveState(player, state);
}

function updateZiplineFallProtection(
  player: Player,
  state: ZiplineHookshotState,
  def: ZiplineHookshotDefinition,
): void {
  const fp = def.fallProtection;
  const anchorVelY =
    state.railLength > 0.0001
      ? ((state.railEnd.y - state.railStart.y) / state.railLength) *
        state.railVelocity
      : 0;
  const playerVelY = player.getVelocity().y;

  const isGentleDescent =
    !player.isOnGround &&
    playerVelY < 0 &&
    anchorVelY >= fp.minAnchorVelY &&
    playerVelY >= fp.minPlayerVelY;

  if (!isGentleDescent) {
    state.gentleDescentTicks = 0;
    return;
  }

  const consecutive = (state.gentleDescentTicks ?? 0) + 1;
  state.gentleDescentTicks = consecutive;

  if (consecutive < fp.requiredConsecutiveTicks) {
    return;
  }

  const lastTick = state.lastSlowFallTick ?? -fp.cooldownTicks;
  if (system.currentTick - lastTick < fp.cooldownTicks) {
    return;
  }

  try {
    player.addEffect("slow_falling", 1, {
      amplifier: 0,
      showParticles: false,
    });
  } catch {}
  state.lastSlowFallTick = system.currentTick;
}
