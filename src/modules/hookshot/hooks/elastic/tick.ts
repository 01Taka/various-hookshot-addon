import { Vector3Utils } from "@minecraft/math";
import { Player, system, world } from "@minecraft/server";
import { PlayerStateManager } from "addon-utils";
import { EPSILON } from "../../constants";
import { HookshotContext, ReelMode, UnhookOptions } from "../../types";
import { ELASTIC_AIR_CHAIN_KEY, elasticHookshotConfig } from "./config";
import { ElasticAirChainState, ElasticHookshotState } from "./type";

let isElasticTrackingInitialized = false;

/**
 * 伸縮ロープフックの空中連続発動状態追跡（着地監視ループ）を初期化します。
 */
export function initElasticHookshotTracking(): void {
  if (isElasticTrackingInitialized) return;
  isElasticTrackingInitialized = true;

  system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
      if (!player.isValid) continue;

      const chain = PlayerStateManager.get<ElasticAirChainState | null>(
        player.id,
        ELASTIC_AIR_CHAIN_KEY,
        null,
      );
      if (!chain) continue;

      const isGrounded =
        player.isOnGround || player.isInWater || player.isClimbing;

      if (!isGrounded) {
        if (!chain.hasBeenAirborne) {
          chain.hasBeenAirborne = true;
          PlayerStateManager.set(player.id, ELASTIC_AIR_CHAIN_KEY, chain);
        }
      } else if (
        chain.hasBeenAirborne ||
        system.currentTick - chain.launchTick >= 10
      ) {
        PlayerStateManager.delete(player.id, ELASTIC_AIR_CHAIN_KEY);
      }
    }
  }, 1);
}

initElasticHookshotTracking();

export function markElasticAirLaunch(player: Player): void {
  const isGrounded =
    player.isOnGround || player.isInWater || player.isClimbing;
  PlayerStateManager.set<ElasticAirChainState>(
    player.id,
    ELASTIC_AIR_CHAIN_KEY,
    {
      hasBeenAirborne: !isGrounded,
      launchTick: system.currentTick,
    },
  );
}

export function isElasticAirChainActive(player: Player): boolean {
  return (
    PlayerStateManager.get<ElasticAirChainState | null>(
      player.id,
      ELASTIC_AIR_CHAIN_KEY,
      null,
    ) !== null
  );
}

export function onElasticBeforeDetach(
  player: Player,
  state: ElasticHookshotState,
  options: UnhookOptions | undefined,
  calculateImpulse: (player: Player, state: ElasticHookshotState) => {
    x: number;
    y: number;
    z: number;
  },
  ctx: HookshotContext,
): void {
  if (
    !options?.skipReleaseShot &&
    state.isReelingIn &&
    player.dimension.id === state.anchor.dimensionId
  ) {
    const distance = Vector3Utils.distance(player.location, state.anchor);
    const stretch =
      Math.max(0, distance - state.currentLength) + (state.extraCharge ?? 0);
    if (stretch > elasticHookshotConfig.release.minStretch) {
      state.isReelingIn = false;
      state.isChargeReleasing = true;
      state.releaseShotPending = true;
      const impulse = calculateImpulse(player, state);
      if (impulse.x !== 0 || impulse.y !== 0 || impulse.z !== 0) {
        player.applyImpulse(impulse);
      }
      markElasticAirLaunch(player);
      ctx.playSound(player, elasticHookshotConfig.release.soundId);
    }
  }
}

export function modifyElasticReelSpeed(
  player: Player,
  state: ElasticHookshotState,
  mode: ReelMode,
  baseSpeed: number,
): number {
  if (mode !== "shorten") return baseSpeed;
  const distance = Vector3Utils.distance(player.location, state.anchor);
  const { minDistance, maxDistance, maxSpeed } =
    elasticHookshotConfig.distanceReelSpeed;
  const span = Math.max(EPSILON, maxDistance - minDistance);
  const t = Math.min(1, Math.max(0, (distance - minDistance) / span));

  if (isElasticAirChainActive(player)) {
    const { airChainMinSpeed, airChainMaxSpeed } =
      elasticHookshotConfig.chargeSpeedBoost;
    return Math.max(
      baseSpeed,
      airChainMinSpeed + t * (airChainMaxSpeed - airChainMinSpeed),
    );
  }
  return baseSpeed + t * (maxSpeed - baseSpeed);
}

export function applyElasticLengthDelta(
  state: ElasticHookshotState,
  mode: ReelMode,
  delta: number,
): boolean {
  const prevLength = state.currentLength;
  const prevExtra = state.extraCharge ?? 0;
  let nextLength = prevLength;
  let nextExtra = prevExtra;

  if (mode === "extend") {
    const maxLength = elasticHookshotConfig.maxDistance;
    if (prevExtra > 0) {
      const consumedExtra = Math.min(prevExtra, delta);
      nextExtra = prevExtra - consumedExtra;
      const remaining = delta - consumedExtra;
      if (remaining > 0) {
        nextLength = Math.min(prevLength + remaining, maxLength);
      }
    } else {
      nextLength = Math.min(prevLength + delta, maxLength);
    }
  } else {
    const minLength = elasticHookshotConfig.minRopeLength;
    const maxExtra = elasticHookshotConfig.maxExtraCharge ?? Infinity;
    const shortenRoom = Math.max(0, prevLength - minLength);
    if (delta <= shortenRoom) {
      nextLength = Math.max(prevLength - delta, minLength);
    } else {
      nextLength = minLength;
      if (maxExtra > 0) {
        const remaining = delta - shortenRoom;
        nextExtra = Number.isFinite(maxExtra)
          ? Math.min(maxExtra, prevExtra + remaining)
          : prevExtra + remaining;
      }
    }
  }

  const changed = prevLength !== nextLength || prevExtra !== nextExtra;
  if (changed) {
    state.currentLength = nextLength;
    state.extraCharge = nextExtra;
  }
  return changed;
}

export function onElasticTick(
  player: Player,
  state: ElasticHookshotState,
  wasReelingIn: boolean,
  ctx: HookshotContext,
): void {
  const distance = Vector3Utils.distance(player.location, state.anchor);
  let releaseStateDirty = false;

  if (state.isReelingIn) {
    if (
      state.isChargeReleasing ||
      state.releaseShotPending ||
      state.releaseStartTick !== undefined ||
      state.lastReleaseDistance !== undefined ||
      state.releaseStallTicks !== undefined
    ) {
      state.isChargeReleasing = false;
      state.releaseShotPending = false;
      state.releaseStartTick = undefined;
      state.lastReleaseDistance = undefined;
      state.releaseStallTicks = undefined;
      releaseStateDirty = true;
    }
  } else if (wasReelingIn && !state.isReelingIn) {
    const stretch =
      Math.max(0, distance - state.currentLength) + (state.extraCharge ?? 0);
    if (stretch <= elasticHookshotConfig.release.minStretch) {
      const minLength = elasticHookshotConfig.minRopeLength;
      const maxLength = elasticHookshotConfig.maxDistance;
      state.currentLength = Math.max(minLength, Math.min(maxLength, distance));
      state.extraCharge = 0;
      state.isChargeReleasing = false;
      state.releaseShotPending = false;
      state.releaseStartTick = undefined;
      state.lastReleaseDistance = undefined;
      state.releaseStallTicks = undefined;
      releaseStateDirty = true;
    } else {
      state.isChargeReleasing = true;
      state.releaseShotPending = true;
      state.releaseStartTick = system.currentTick;
      state.lastReleaseDistance = distance;
      state.releaseStallTicks = 0;
      releaseStateDirty = true;
      markElasticAirLaunch(player);
      ctx.playSound(player, elasticHookshotConfig.release.soundId);
    }
  } else if (state.isChargeReleasing) {
    const elapsedTicks =
      system.currentTick - (state.releaseStartTick ?? system.currentTick);
    if (distance <= state.currentLength) {
      state.isChargeReleasing = false;
      state.releaseShotPending = false;
      state.releaseStartTick = undefined;
      state.lastReleaseDistance = undefined;
      state.releaseStallTicks = undefined;
      releaseStateDirty = true;
    } else if (
      elapsedTicks >= elasticHookshotConfig.release.minFlightTicks
    ) {
      const approachSpeed = (state.lastReleaseDistance ?? distance) - distance;
      state.releaseStallTicks =
        approachSpeed <= elasticHookshotConfig.release.stallApproachSpeed
          ? (state.releaseStallTicks ?? 0) + 1
          : 0;
      const isStoppedOrPassed =
        state.releaseStallTicks >= elasticHookshotConfig.release.maxStallTicks;
      const isGrounded =
        player.isOnGround || player.isInWater || player.isClimbing;
      const isTimedOut =
        elapsedTicks >= elasticHookshotConfig.release.maxReleaseTicks;

      if (isStoppedOrPassed || isGrounded || isTimedOut) {
        const minLength = elasticHookshotConfig.minRopeLength;
        const maxLength = elasticHookshotConfig.maxDistance;
        state.currentLength = Math.max(
          minLength,
          Math.min(maxLength, distance),
        );
        state.isChargeReleasing = false;
        state.releaseShotPending = false;
        state.releaseStartTick = undefined;
        state.lastReleaseDistance = undefined;
        state.releaseStallTicks = undefined;
        releaseStateDirty = true;
      } else {
        state.lastReleaseDistance = distance;
        releaseStateDirty = true;
      }
    } else {
      state.lastReleaseDistance = distance;
      releaseStateDirty = true;
    }
  }

  if (releaseStateDirty) {
    ctx.setActiveState(player, state);
  }

  updateElasticChargeMilestoneSound(player, state, distance, ctx);
}

function updateElasticChargeMilestoneSound(
  player: Player,
  state: ElasticHookshotState,
  distance: number,
  ctx: HookshotContext,
): void {
  const config = elasticHookshotConfig.chargeMilestoneSound;

  if (!state.isReelingIn) {
    if (
      state.prevChargeStretch !== undefined ||
      state.lastChargeSoundThreshold !== undefined ||
      state.canRetriggerLastThreshold !== undefined
    ) {
      state.prevChargeStretch = undefined;
      state.lastChargeSoundThreshold = undefined;
      state.canRetriggerLastThreshold = undefined;
      ctx.setActiveState(player, state);
    }
    return;
  }

  const stretch =
    Math.max(0, distance - state.currentLength) + (state.extraCharge ?? 0);
  if (stretch <= 0) {
    if (state.prevChargeStretch !== 0) {
      state.prevChargeStretch = 0;
      ctx.setActiveState(player, state);
    }
    return;
  }

  const prev = state.prevChargeStretch ?? stretch;
  let dirty = false;

  if (
    state.lastChargeSoundThreshold !== undefined &&
    !state.canRetriggerLastThreshold &&
    Math.abs(stretch - state.lastChargeSoundThreshold) >= config.hysteresis
  ) {
    state.canRetriggerLastThreshold = true;
    dirty = true;
  }

  const maxSteps = Math.floor(config.maxStretch / config.step);
  for (let i = 1; i <= maxSteps; i++) {
    const threshold = config.step * i;
    const crossedUp = prev < threshold && stretch >= threshold;
    const crossedDown = prev >= threshold && stretch < threshold;
    if (!crossedUp && !crossedDown) continue;

    if (
      state.lastChargeSoundThreshold === threshold &&
      !state.canRetriggerLastThreshold
    ) {
      continue;
    }

    const pitch =
      config.pitches[Math.min(i - 1, config.pitches.length - 1)] ?? 1.0;
    ctx.playSound(player, config.soundId, pitch);
    state.lastChargeSoundThreshold = threshold;
    state.canRetriggerLastThreshold = false;
    dirty = true;
  }

  if (state.prevChargeStretch !== stretch) {
    state.prevChargeStretch = stretch;
    dirty = true;
  }

  if (dirty) {
    ctx.setActiveState(player, state);
  }
}

export function formatElasticHudText(
  _player: Player,
  state: ElasticHookshotState,
  distance: number,
): string {
  const stretch =
    Math.max(0, distance - state.currentLength) + (state.extraCharge ?? 0);
  const prefix = state.isReelingIn ? "[溜め] " : "";
  const stretchSuffix = stretch > 0.1 ? ` (+${stretch.toFixed(1)}m)` : "";
  return `${prefix}${distance.toFixed(1)}m / ${state.currentLength.toFixed(1)}m${stretchSuffix}`;
}
