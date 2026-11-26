import { Vector3Utils } from "@minecraft/math";
import { Player, Vector3 } from "@minecraft/server";
import { HookshotContext, ReelMode } from "../../types";
import { springHookshotConfig } from "./config";
import { SpringHookshotState } from "./type";

/**
 * 現在の設定に応じた曲げ基準軸（角度維持ベクトル）を取得します
 */
export function getSpringBendingAxis(
  state: SpringHookshotState,
): Vector3 | undefined {
  return springHookshotConfig.bendingMode === "shot_angle"
    ? (state.initialDirection ?? state.normal)
    : state.normal;
}

export function modifySpringReelSpeed(
  player: Player,
  state: SpringHookshotState,
  mode: ReelMode,
  baseSpeed: number,
  isInitial: boolean,
): number {
  if (state.isAnchored === false) return baseSpeed;

  if (mode === "shorten") {
    const distance = Vector3Utils.distance(player.location, state.anchor);
    const compression = state.currentLength - distance;
    if (compression > 0) {
      const { brakePerBlock, minSpeedMultiplier } =
        springHookshotConfig.shortenCompressionBrake;
      const multiplier = Math.max(
        minSpeedMultiplier,
        1 / (1 + Math.max(0, brakePerBlock) * compression),
      );
      return baseSpeed * multiplier;
    }
  } else if (mode === "extend" && springHookshotConfig.matchOutwardExtend) {
    const distance = Vector3Utils.distance(player.location, state.anchor);
    const prevDistance = state.lastExtendDistance;
    state.lastExtendDistance = distance;
    if (
      !isInitial &&
      prevDistance !== undefined &&
      distance < state.currentLength
    ) {
      const outwardDelta = Math.max(0, distance - prevDistance);
      return Math.max(baseSpeed, outwardDelta);
    }
  }
  return baseSpeed;
}

export function onSpringTick(
  player: Player,
  state: SpringHookshotState,
  activeReelMode: ReelMode | null,
  ctx: HookshotContext,
): void {
  if (state.isAnchored === false) return;

  let dirty = false;
  if (state.lastExtendDistance !== undefined) {
    if (activeReelMode !== "extend") {
      state.lastExtendDistance = undefined;
    }
    dirty = true;
  }

  if (state.isAutoExtendingToMin) {
    const targetMinLength = Math.min(
      springHookshotConfig.minRopeLength,
      springHookshotConfig.maxDistance,
    );
    if (state.currentLength >= targetMinLength) {
      state.isAutoExtendingToMin = false;
    } else {
      const stepPerTick = Math.max(
        0,
        springHookshotConfig.autoExtendToMin.speed,
      );
      const nextLength = Math.min(
        state.currentLength + stepPerTick,
        targetMinLength,
      );
      state.currentLength = nextLength;
      if (nextLength >= targetMinLength) {
        state.isAutoExtendingToMin = false;
      }
    }
    dirty = true;
  }

  if (dirty) {
    ctx.setActiveState(player, state);
  }
}

export function formatSpringHudText(
  _player: Player,
  state: SpringHookshotState,
  distance: number,
): string {
  const diff = distance - state.currentLength;
  const diffSuffix =
    Math.abs(diff) > 0.1
      ? ` (${diff > 0 ? "+" : ""}${diff.toFixed(1)}m)`
      : "";
  return `${distance.toFixed(1)}m / ${state.currentLength.toFixed(1)}m${diffSuffix}`;
}
