import { Vector3Utils } from "@minecraft/math";
import { Dimension, Player, system, Vector3 } from "@minecraft/server";
import { isInputButtonPressed, isSneakButtonPressed } from "addon-utils";
import { TICKS_PER_SECOND } from "../../constants";
import { HookshotContext } from "../../types";
import { ziplineHookshotConfig } from "./config";
import { stepZiplineRailAnchor } from "./math";
import { ZiplineHookshotState } from "./type";

function isSupportBlockBroken(dimension: Dimension, blockPos: Vector3): boolean {
  try {
    const block = dimension.getBlock(blockPos);
    if (!block) return false;
    return block.isAir || block.isLiquid;
  } catch {
    return false;
  }
}

function updateZiplineFallProtection(
  player: Player,
  state: ZiplineHookshotState,
): void {
  const fp = ziplineHookshotConfig.fallProtection;
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

export function onZiplineTick(
  player: Player,
  state: ZiplineHookshotState,
  ctx: HookshotContext,
): boolean | void {
  if (
    isSupportBlockBroken(player.dimension, state.startSupportBlock) ||
    isSupportBlockBroken(player.dimension, state.endSupportBlock)
  ) {
    ctx.unhook(player);
    return false;
  }

  if (!player.isValid) return;

  const def = ziplineHookshotConfig;
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

  updateZiplineFallProtection(player, state);

  ctx.setActiveState(player, state);
}

export function formatZiplineHudText(
  _player: Player,
  state: ZiplineHookshotState,
): string {
  const sign = state.facingDirectionSign ?? 1;
  const remaining = Math.max(
    0,
    sign >= 0 ? state.railLength - state.railProgress : state.railProgress,
  );
  const railSpeed = Math.abs(state.railVelocity) * TICKS_PER_SECOND;
  return `残 ${remaining.toFixed(1)}m / ${state.railLength.toFixed(1)}m | レール ${railSpeed.toFixed(1)} m/s`;
}
