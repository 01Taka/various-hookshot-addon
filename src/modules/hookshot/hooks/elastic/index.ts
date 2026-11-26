import { AeroVestSystem } from "../../../sub-items/aero-vest";
import { elasticHookshotConfig } from "./config";
import { calculateElasticHookshot } from "./math";
import {
  applyElasticLengthDelta,
  formatElasticHudText,
  modifyElasticReelSpeed,
  onElasticBeforeDetach,
  onElasticTick,
} from "./tick";
import { ElasticHookshotDefinition } from "./type";

export * from "./type";
export * from "./config";
export * from "./math";
export {
  initElasticHookshotTracking,
  isElasticAirChainActive,
  markElasticAirLaunch,
} from "./tick";

/**
 * リード（minecraft:lead）を使用した伸縮性（ゴム紐）フックショットの定義
 */
export const elasticHookshotDefinition: ElasticHookshotDefinition = {
  ...elasticHookshotConfig,
  calculateImpulse: (player, state) => {
    const {
      minConstraintLength,
      constraintLengthMultiplier,
      ...elasticParams
    } = elasticHookshotConfig.physics;
    return calculateElasticHookshot(player, state.anchor, {
      naturalLength: state.currentLength,
      extraCharge: state.extraCharge,
      maxLength: Math.max(
        minConstraintLength,
        state.currentLength * constraintLengthMultiplier,
      ),
      baumgarteFactor: elasticHookshotConfig.baumgarteFactor ?? 0.15,
      isReelingIn: state.isReelingIn,
      isChargeReleasing: state.isChargeReleasing,
      releaseShotPending: state.releaseShotPending,
      boostInputChargeControl: AeroVestSystem.isEquipped(player),
      release: elasticHookshotConfig.release,
      ...elasticParams,
    });
  },
  hasChargeRelease: true,
  getRenderExtraCharge: (state) => state.extraCharge,
  onBeforeDetach: (player, state, options, ctx) =>
    onElasticBeforeDetach(
      player,
      state,
      options,
      elasticHookshotDefinition.calculateImpulse,
      ctx,
    ),
  modifyReelSpeed: (player, state, mode, baseSpeed) =>
    modifyElasticReelSpeed(player, state, mode, baseSpeed),
  customApplyLengthDelta: (_player, state, mode, delta) =>
    applyElasticLengthDelta(state, mode, delta),
  onTick: (player, state, { wasReelingIn }, ctx) =>
    onElasticTick(player, state, wasReelingIn, ctx),
  shouldDetach: (_player, state, distance) => {
    const stretch =
      Math.max(0, distance - state.currentLength) + (state.extraCharge ?? 0);
    if (stretch > elasticHookshotConfig.maxOverstretchDistance) {
      return {
        detach: true,
        options: {
          skipReleaseShot: true,
          overrideSoundId: elasticHookshotConfig.overstretchSoundId,
        },
      };
    }
    return { detach: false };
  },
  onImpulseApplied: (player, state, _impulse, ctx) => {
    if (state.releaseShotPending) {
      state.releaseShotPending = false;
      state.extraCharge = 0;
      ctx.setActiveState(player, state);
    }
  },
  formatHudText: (player, state, distance) =>
    formatElasticHudText(player, state, distance),
};
