import { Vector3Utils } from "@minecraft/math";
import { Player } from "@minecraft/server";
import { EPSILON } from "../../constants";
import {
  calculateAboveAnchorDecayFactor,
  calculateReelSpeedMultiplier,
  calculateRigidSteering,
} from "../../math/steering-math";
import { HookshotContext, ReelMode } from "../../types";
import { rigidHookshotConfig } from "./config";
import { RigidHookshotState } from "./type";

export function isRigidReelBlocked(
  player: Player,
  state: RigidHookshotState,
  mode: ReelMode,
  ctx: HookshotContext,
): boolean {
  if (mode !== "shorten") return false;
  const { maxSpeed, ticks, restoreDiff } = rigidHookshotConfig.stallReelStop;
  const distance = Vector3Utils.distance(player.location, state.anchor);
  const diff = distance - state.currentLength;
  const speed = Vector3Utils.magnitude(player.getVelocity());
  const prevTicks = state.stallReelTicks ?? 0;

  if (speed <= maxSpeed && diff >= restoreDiff - 0.01) {
    if (prevTicks >= ticks) {
      if (diff > restoreDiff) {
        state.currentLength = Math.min(
          rigidHookshotConfig.maxDistance,
          distance - restoreDiff,
        );
        ctx.setActiveState(player, state);
      }
      return true;
    }
    if (diff > restoreDiff) {
      const nextTicks = prevTicks + 1;
      state.stallReelTicks = nextTicks;
      if (nextTicks >= ticks) {
        state.currentLength = Math.min(
          rigidHookshotConfig.maxDistance,
          distance - restoreDiff,
        );
        ctx.setActiveState(player, state);
        return true;
      }
      ctx.setActiveState(player, state);
      return false;
    }
  }

  if (prevTicks !== 0) {
    state.stallReelTicks = 0;
    ctx.setActiveState(player, state);
  }
  return false;
}

export function modifyRigidReelSpeed(
  player: Player,
  state: RigidHookshotState,
  mode: ReelMode,
  baseSpeed: number,
): number {
  if (mode === "shorten" && rigidHookshotConfig.enableGazeSteering) {
    const multiplier = calculateReelSpeedMultiplier(
      player,
      state.anchor,
      state.currentLength,
      rigidHookshotConfig.steering,
    );
    return baseSpeed * multiplier;
  }
  return baseSpeed;
}

export function onRigidLengthChanged(
  player: Player,
  state: RigidHookshotState,
  mode: ReelMode,
  _prevLength: number,
  nextLength: number,
): void {
  const outward = rigidHookshotConfig.reelLengthDiffLimit?.outward;
  if (mode === "shorten" && outward !== undefined && state.isReelingIn) {
    const distance = Vector3Utils.distance(player.location, state.anchor);
    const minAllowedByDiff = distance - outward;
    if (nextLength <= minAllowedByDiff) {
      state.isReelingIn = false;
    }
  }
}

export function onRigidTick(
  player: Player,
  state: RigidHookshotState,
  activeReelMode: ReelMode | null,
  ctx: HookshotContext,
): void {
  let dirty = false;

  if (activeReelMode !== "shorten" && state.stallReelTicks) {
    state.stallReelTicks = 0;
    dirty = true;
  }

  const maxAboveTicks = rigidHookshotConfig.steering.aboveAnchorDecayTicks;
  const currentAboveTicks = state.aboveAnchorTicks ?? 0;
  const currentBelowTicks = state.belowAnchorTicks ?? 0;

  if (player.location.y >= state.anchor.y) {
    if (currentBelowTicks !== 0) {
      state.belowAnchorTicks = 0;
      dirty = true;
    }
    if (currentAboveTicks < maxAboveTicks) {
      state.aboveAnchorTicks = currentAboveTicks + 1;
      dirty = true;
    }
  } else if (currentAboveTicks > 0) {
    const nextBelowTicks = currentBelowTicks + 1;
    if (nextBelowTicks !== currentBelowTicks) {
      state.belowAnchorTicks = nextBelowTicks;
      dirty = true;
    }
    const recoveryDelayTicks =
      rigidHookshotConfig.steering.belowAnchorRecoveryDelayTicks ?? 4;
    const recoveryRate =
      rigidHookshotConfig.steering.belowAnchorRecoveryRate ?? 1;
    if (nextBelowTicks >= recoveryDelayTicks) {
      const nextAboveTicks = Math.max(0, currentAboveTicks - recoveryRate);
      if (nextAboveTicks !== currentAboveTicks) {
        state.aboveAnchorTicks = nextAboveTicks;
        if (nextAboveTicks === 0) {
          state.belowAnchorTicks = 0;
        }
        dirty = true;
      }
    }
  } else if (currentBelowTicks !== 0) {
    state.belowAnchorTicks = 0;
    dirty = true;
  }

  const remaining = state.autoTakeUpRemainingTicks ?? 0;
  if (remaining > 0) {
    if (activeReelMode !== null) {
      state.autoTakeUpRemainingTicks = 0;
      dirty = true;
    } else {
      const distance = Vector3Utils.distance(player.location, state.anchor);
      const minLength = rigidHookshotConfig.minRopeLength;
      if (distance < state.currentLength) {
        state.currentLength = Math.max(
          minLength,
          distance,
          state.currentLength - rigidHookshotConfig.autoTakeUp.speed,
        );
      }
      state.autoTakeUpRemainingTicks =
        state.currentLength <= minLength ? 0 : remaining - 1;
      dirty = true;
    }
  }

  if (dirty) {
    ctx.setActiveState(player, state);
  }
}

export function formatRigidHudText(
  player: Player,
  state: RigidHookshotState,
  distance: number,
): string {
  const decayFactor = calculateAboveAnchorDecayFactor(
    state.aboveAnchorTicks ?? 0,
    rigidHookshotConfig.steering,
  );
  const decayPercent = Math.round((1 - decayFactor) * 100);

  const steerResult = calculateRigidSteering(
    player,
    state.anchor,
    rigidHookshotConfig.steering,
  );
  const maxTiltRad =
    (rigidHookshotConfig.steering.maxUpwardTiltDeg * Math.PI) / 180;
  const rawEffectRatio =
    maxTiltRad > EPSILON
      ? Math.min(1, steerResult.targetTiltRad / maxTiltRad)
      : 0;
  const effectPercent = Math.round(rawEffectRatio * decayFactor * 100);

  return `${distance.toFixed(1)}m / ${state.currentLength.toFixed(1)}m | 減衰:${decayPercent}% 効果:${effectPercent}%`;
}
