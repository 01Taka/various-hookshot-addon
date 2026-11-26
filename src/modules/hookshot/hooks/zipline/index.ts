import { Vector3Utils } from "@minecraft/math";
import { isInputButtonPressed, isSneakButtonPressed } from "addon-utils";
import { AeroVestSystem } from "../../../sub-items/aero-vest";
import { ziplineHookshotConfig } from "./config";
import { calculateZiplineHookshot } from "./math";
import { renderZiplineHookshot } from "./render";
import { shotZipline } from "./shot";
import { formatZiplineHudText, onZiplineTick } from "./tick";
import { ZiplineHookshotDefinition } from "./type";

export * from "./type";
export * from "./config";
export * from "./math";

export const ziplineHookshotDefinition: ZiplineHookshotDefinition = {
  ...ziplineHookshotConfig,
  calculateImpulse: (player, state) => {
    const hasVest = AeroVestSystem.isEquipped(player);
    const { physics, steering, baumgarteFactor } = ziplineHookshotConfig;
    const railDir =
      state.railLength > 0.0001
        ? Vector3Utils.scale(
            Vector3Utils.subtract(state.railEnd, state.railStart),
            1 / state.railLength,
          )
        : { x: 0, y: 0, z: 1 };
    const anchorVelocity =
      state.railVelocity !== 0
        ? Vector3Utils.scale(railDir, state.railVelocity)
        : { x: 0, y: 0, z: 0 };

    let isPropelling = false;
    try {
      isPropelling =
        isInputButtonPressed(player, "Jump") ||
        player.isJumping ||
        isSneakButtonPressed(player);
    } catch {
      isPropelling = false;
    }

    return calculateZiplineHookshot(player, state.anchor, state.currentLength, {
      baumgarteFactor: baumgarteFactor ?? 0.42,
      physics,
      steering,
      swingPumpAccel: hasVest
        ? physics.swingPumpAccelVest
        : physics.swingPumpAccelNormal,
      railDir,
      anchorVelocity,
      parallelDamping: 0.14,
      lateralDamping: 0.02,
      suppressParallelSwing: isPropelling,
    });
  },
  customShot: (player, ctx) => shotZipline(player, ctx),
  onTick: (player, state, _info, ctx) => onZiplineTick(player, state, ctx),
  render: (player, state) => renderZiplineHookshot(player, state),
  formatHudText: (player, state) => formatZiplineHudText(player, state),
};
