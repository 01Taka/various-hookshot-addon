import { system } from "@minecraft/server";
import { springHookshotConfig } from "./config";
import { calculateSpringHookshot } from "./math";
import {
  formatSpringHudText,
  getSpringBendingAxis,
  modifySpringReelSpeed,
  onSpringTick,
} from "./runtime";
import { SpringHookshotDefinition } from "./type";

export * from "./type";
export * from "./config";
export * from "./math";
export { getSpringBendingAxis } from "./runtime";

/**
 * スライムボール（minecraft:slime_ball）を使用した双方向バネフックショットの定義
 */
export const springHookshotDefinition: SpringHookshotDefinition = {
  ...springHookshotConfig,
  getWireAxis: (state) => getSpringBendingAxis(state),
  calculateImpulse: (player, state) => {
    const bendingAxis = getSpringBendingAxis(state);
    const {
      minConstraintLength,
      constraintLengthMultiplier,
      ...springParams
    } = springHookshotConfig.physics;

    const { boostedDamping, rampUpTicks, rampDownTicks } =
      springHookshotConfig.shortenBendingDamping;
    const isShortening = state.lastShortenTick === system.currentTick;
    const prevBlend = state.shortenDampingBlend ?? 0;
    const nextBlend = isShortening
      ? Math.min(1, prevBlend + 1 / Math.max(1, rampUpTicks))
      : Math.max(0, prevBlend - 1 / Math.max(1, rampDownTicks));
    state.shortenDampingBlend = nextBlend;

    const effectiveBendingDamping =
      springParams.bendingDamping +
      (boostedDamping - springParams.bendingDamping) * nextBlend;

    return calculateSpringHookshot(player, state.anchor, {
      naturalLength: state.currentLength,
      maxLength: Math.max(
        minConstraintLength,
        state.currentLength * constraintLengthMultiplier,
      ),
      baumgarteFactor: springHookshotConfig.baumgarteFactor ?? 0.15,
      surfaceNormal: state.normal,
      bendingAxis,
      ...springParams,
      bendingDamping: effectiveBendingDamping,
    });
  },
  onAttach: (_player, state, { initialDirection, distance }) => {
    state.initialDirection = initialDirection;
    const targetMinLength = Math.min(
      springHookshotConfig.minRopeLength,
      springHookshotConfig.maxDistance,
    );
    state.isAutoExtendingToMin = distance < targetMinLength;
  },
  onDetach: (_player, state) => {
    state.isAutoExtendingToMin = false;
    state.lastExtendDistance = undefined;
  },
  canHandleReelInput: (_player, state) => !state.isAutoExtendingToMin,
  modifyReelSpeed: (player, state, mode, baseSpeed, isInitial) =>
    modifySpringReelSpeed(player, state, mode, baseSpeed, isInitial),
  onLengthChanged: (_player, state, mode) => {
    if (mode === "shorten") {
      state.lastShortenTick = system.currentTick;
    }
  },
  onTick: (player, state, { activeReelMode }, ctx) =>
    onSpringTick(player, state, activeReelMode, ctx),
  formatHudText: (player, state, distance) =>
    formatSpringHudText(player, state, distance),
};
