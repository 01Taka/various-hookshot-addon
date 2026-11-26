import { Vector3 } from "@minecraft/server";
import { magnetHookshotConfig } from "./config";
import { calculateMagnetHookshot } from "./math";
import { renderMagnetHookshot } from "./render";
import { onMagnetShot, onMagnetToggleWhileActive } from "./shot";
import {
  formatMagnetHudText,
  onMagnetImpulseApplied,
  stepMagnetState,
} from "./tick";
import { MagnetHookshotDefinition } from "./type";

export * from "./type";
export * from "./config";
export * from "./math";
export { createMagnetStateFromHit } from "./shot";
export { stepMagnetState } from "./tick";
export { renderMagnetHookshot } from "./render";

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
