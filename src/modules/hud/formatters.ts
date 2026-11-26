import { Player } from "@minecraft/server";
import {
  calculateAboveAnchorDecayFactor,
  calculateMagnetEffectRatio,
  calculateRigidSteering,
  ELASTIC_HOOKSHOT_ID,
  ElasticHookshotState,
  EPSILON,
  HookshotDefinition,
  HookshotState,
  MAGNET_HOOKSHOT_ID,
  MagnetHookshotDefinition,
  MagnetHookshotState,
  RIGID_HOOKSHOT_ID,
  RigidHookshotDefinition,
  RigidHookshotState,
  SPRING_HOOKSHOT_ID,
  TICKS_PER_SECOND,
  ZIPLINE_HOOKSHOT_ID,
  ZiplineHookshotState,
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
  if (def.id === ELASTIC_HOOKSHOT_ID && state.hookshotId === ELASTIC_HOOKSHOT_ID) {
    const elasticState = state as ElasticHookshotState;
    const stretch =
      Math.max(0, distance - elasticState.currentLength) +
      (elasticState.extraCharge ?? 0);
    const prefix = elasticState.isReelingIn ? "[溜め] " : "";
    const stretchSuffix = stretch > 0.1 ? ` (+${stretch.toFixed(1)}m)` : "";
    return `${prefix}${distance.toFixed(1)}m / ${elasticState.currentLength.toFixed(1)}m${stretchSuffix}`;
  }

  if (def.id === SPRING_HOOKSHOT_ID && state.hookshotId === SPRING_HOOKSHOT_ID) {
    const diff = distance - state.currentLength;
    const diffSuffix =
      Math.abs(diff) > 0.1
        ? ` (${diff > 0 ? "+" : ""}${diff.toFixed(1)}m)`
        : "";
    return `${distance.toFixed(1)}m / ${state.currentLength.toFixed(1)}m${diffSuffix}`;
  }

  if (def.id === ZIPLINE_HOOKSHOT_ID && state.hookshotId === ZIPLINE_HOOKSHOT_ID) {
    const zipState = state as ZiplineHookshotState;
    const sign = zipState.facingDirectionSign ?? 1;
    const remaining = Math.max(
      0,
      sign >= 0 ? zipState.railLength - zipState.railProgress : zipState.railProgress,
    );
    const railSpeed = Math.abs(zipState.railVelocity) * TICKS_PER_SECOND;
    return `残 ${remaining.toFixed(1)}m / ${zipState.railLength.toFixed(1)}m | レール ${railSpeed.toFixed(1)} m/s`;
  }

  if (def.id === MAGNET_HOOKSHOT_ID && state.hookshotId === MAGNET_HOOKSHOT_ID) {
    const magnetDef = def as MagnetHookshotDefinition;
    const magnetState = state as MagnetHookshotState;
    const effectRatio = calculateMagnetEffectRatio(distance, magnetDef.physics);
    const effectPercent = Math.round(effectRatio * 100);
    const modeText =
      magnetState.activeMode === "attract"
        ? magnetState.isStuck
          ? "吸着固定(Shift)"
          : "吸引(Shift)"
        : magnetState.activeMode === "repel"
          ? "反発(Jump)"
          : effectRatio <= 0
            ? "待機ゾーン"
            : "待機";
    return `${distance.toFixed(1)}m (効果 ${effectPercent}%) | ${modeText}`;
  }

  if (def.id === RIGID_HOOKSHOT_ID && state.hookshotId === RIGID_HOOKSHOT_ID) {
    const rigidDef = def as RigidHookshotDefinition;
    const rigidState = state as RigidHookshotState;
    const decayFactor = calculateAboveAnchorDecayFactor(
      rigidState.aboveAnchorTicks ?? 0,
      rigidDef.steering,
    );
    const decayPercent = Math.round((1 - decayFactor) * 100);

    const steerResult = calculateRigidSteering(
      player,
      rigidState.anchor,
      rigidDef.steering,
    );
    const maxTiltRad = (rigidDef.steering.maxUpwardTiltDeg * Math.PI) / 180;
    const rawEffectRatio =
      maxTiltRad > EPSILON
        ? Math.min(1, steerResult.targetTiltRad / maxTiltRad)
        : 0;
    const effectPercent = Math.round(rawEffectRatio * decayFactor * 100);

    return `${distance.toFixed(1)}m / ${rigidState.currentLength.toFixed(1)}m | 減衰:${decayPercent}% 効果:${effectPercent}%`;
  }

  return `${distance.toFixed(1)}m / ${state.currentLength.toFixed(1)}m`;
}
