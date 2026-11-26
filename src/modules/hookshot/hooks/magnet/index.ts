import { Vector3 } from "@minecraft/server";
import { magnetHookshotConfig } from "./config";
import { calculateMagnetHookshot } from "./math";
import { renderMagnetHookshot } from "./runtime-render";
import { onMagnetShot, onMagnetToggleWhileActive } from "./runtime-shot";
import {
  formatMagnetHudText,
  onMagnetImpulseApplied,
  stepMagnetState,
} from "./runtime-tick";
import { MagnetHookshotDefinition } from "./type";

export * from "./type";
export * from "./config";
export * from "./math";
export { createMagnetStateFromHit } from "./runtime-shot";
export { stepMagnetState } from "./runtime-tick";
export { renderMagnetHookshot } from "./runtime-render";

export const magnetHookshotDefinition: MagnetHookshotDefinition = {
  ...magnetHookshotConfig,
  calculateImpulse: (player, state): Vector3 => {
    return calculateMagnetHookshot(
      player,
      state.anchor,
      state.activeMode,
      !!state.isModeEntryTick,
      !!state.isStuck,
      state.stuckPhase,
      state.stuckLocation,
      state.stuckContactDir,
      state.attractHoldTicks ?? 0,
      state.repelHoldTicks ?? 0,
      magnetHookshotConfig.physics,
    );
  },
  customShot: (player, ctx) => onMagnetShot(player, ctx),
  onToggleWhileActive: (player, _state, ctx) =>
    onMagnetToggleWhileActive(player, ctx),
  onTick: (player, state, _info, ctx) => {
    const keep = stepMagnetState(
      player,
      state,
      magnetHookshotConfig,
      (p, id, pitch) => ctx.playSound(p, id, pitch),
    );
    if (!keep) {
      ctx.unhook(player);
      return false;
    }
    ctx.setActiveState(player, state);
  },
  onImpulseApplied: (player, state, impulse) =>
    onMagnetImpulseApplied(player, state, impulse),
  render: (player, state) => renderMagnetHookshot(player, state),
  formatHudText: (player, state, distance) =>
    formatMagnetHudText(player, state, distance),
};
