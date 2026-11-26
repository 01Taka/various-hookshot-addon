import { Player } from "@minecraft/server";
import {
  calculateAboveAnchorDecayFactor,
  calculateMagnetEffectRatio,
  calculateRigidSteering,
  EPSILON,
  HookshotDefinition,
  HookshotState,
  TICKS_PER_SECOND,
} from "../hookshot";

/**
 * 接続中アクションバーの距離・状態テキストを種別ごとに整形します。
 */
export function formatHookshotDistanceText(
  player: Player,
  def: HookshotDefinition,
  state: HookshotState,
  distance: number,
): string {
  if (def.id === "elastic" && state.hookshotId === "elastic") {
    const stretch =
      Math.max(0, distance - state.currentLength) + (state.extraCharge ?? 0);
    const prefix = state.isReelingIn ? "[溜め] " : "";
    const stretchSuffix = stretch > 0.1 ? ` (+${stretch.toFixed(1)}m)` : "";
    return `${prefix}${distance.toFixed(1)}m / ${state.currentLength.toFixed(1)}m${stretchSuffix}`;
  }

  if (def.id === "spring" && state.hookshotId === "spring") {
    const diff = distance - state.currentLength;
    const diffSuffix =
      Math.abs(diff) > 0.1
        ? ` (${diff > 0 ? "+" : ""}${diff.toFixed(1)}m)`
        : "";
    return `${distance.toFixed(1)}m / ${state.currentLength.toFixed(1)}m${diffSuffix}`;
  }

  if (def.id === "zipline" && state.hookshotId === "zipline") {
    const sign = state.facingDirectionSign ?? 1;
    const remaining = Math.max(
      0,
      sign >= 0 ? state.railLength - state.railProgress : state.railProgress,
    );
    const railSpeed = Math.abs(state.railVelocity) * TICKS_PER_SECOND;
    return `残 ${remaining.toFixed(1)}m / ${state.railLength.toFixed(1)}m | レール ${railSpeed.toFixed(1)} m/s`;
  }

  if (def.id === "magnet" && state.hookshotId === "magnet") {
    const effectRatio = calculateMagnetEffectRatio(distance, def.physics);
    const effectPercent = Math.round(effectRatio * 100);
    const modeText =
      state.activeMode === "attract"
        ? state.isStuck
          ? "吸着固定(Shift)"
          : "吸引(Shift)"
        : state.activeMode === "repel"
          ? "反発(Jump)"
          : effectRatio <= 0
            ? "待機ゾーン"
            : "待機";
    return `${distance.toFixed(1)}m (効果 ${effectPercent}%) | ${modeText}`;
  }

  if (def.id === "rigid" && state.hookshotId === "rigid") {
    const decayFactor = calculateAboveAnchorDecayFactor(
      state.aboveAnchorTicks ?? 0,
      def.steering,
    );
    const decayPercent = Math.round((1 - decayFactor) * 100);

    const steerResult = calculateRigidSteering(
      player,
      state.anchor,
      def.steering,
    );
    const maxTiltRad = (def.steering.maxUpwardTiltDeg * Math.PI) / 180;
    const rawEffectRatio =
      maxTiltRad > EPSILON
        ? Math.min(1, steerResult.targetTiltRad / maxTiltRad)
        : 0;
    const effectPercent = Math.round(rawEffectRatio * decayFactor * 100);

    return `${distance.toFixed(1)}m / ${state.currentLength.toFixed(1)}m | 減衰:${decayPercent}% 効果:${effectPercent}%`;
  }

  return `${distance.toFixed(1)}m / ${state.currentLength.toFixed(1)}m`;
}
