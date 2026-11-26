import { bambooHookshotConfig } from "./config";
import { calculateBambooHookshot } from "./math";
import { onBambooAttach, onBambooDetach, updateBambooTautSound } from "./runtime";
import { BambooHookshotDefinition } from "./type";

export * from "./type";
export * from "./config";
export * from "./math";
export { initBambooHookshotTracking } from "./runtime";

/**
 * 竹（minecraft:bamboo）を使用した弾性圧縮ポール（しなる棒）フックショットの定義
 */
export const bambooHookshotDefinition: BambooHookshotDefinition = {
  ...bambooHookshotConfig,
  calculateImpulse: (player, state) => {
    updateBambooTautSound(player, state.anchor, state.currentLength);

    return calculateBambooHookshot(player, state.anchor, {
      naturalLength: state.currentLength,
      surfaceNormal: state.normal,
      ...bambooHookshotConfig.physics,
    });
  },
  shouldDetach: (_player, state, distance) =>
    distance - state.currentLength >=
    bambooHookshotConfig.maxOverstretchDistance
      ? { detach: true }
      : { detach: false },
  onAttach: (player, state) => onBambooAttach(player, state),
  onDetach: (player) => onBambooDetach(player),
};
