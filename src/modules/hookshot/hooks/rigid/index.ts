import { AeroVestSystem } from "../../../sub-items/aero-vest";
import { rigidHookshotConfig } from "./config";
import { calculateRigidHookshot } from "./math";
import {
  formatRigidHudText,
  isRigidReelBlocked,
  modifyRigidReelSpeed,
  onRigidLengthChanged,
  onRigidTick,
} from "./runtime";
import { RigidHookshotDefinition } from "./type";

export * from "./type";
export * from "./config";
export * from "./math";

/**
 * 糸（minecraft:string）を使用した伸びがない（剛体ロープ）フックショットの定義
 */
export const rigidHookshotDefinition: RigidHookshotDefinition = {
  ...rigidHookshotConfig,
  calculateImpulse: (player, state) => {
    const hasVest = AeroVestSystem.isEquipped(player);
    const { physics, steering, baumgarteFactor } = rigidHookshotConfig;
    return calculateRigidHookshot(player, state.anchor, state.currentLength, {
      isReelingIn: state.isReelingIn,
      enableSteering: true,
      hasAeroVest: hasVest,
      aboveAnchorTicks: state.aboveAnchorTicks,
      baumgarteFactor: baumgarteFactor ?? 0.15,
      physics,
      steering,
      swingPumpAccel: hasVest
        ? physics.swingPumpAccelVest
        : physics.swingPumpAccelNormal,
    });
  },
  onAttach: (_player, state) => {
    state.autoTakeUpRemainingTicks =
      rigidHookshotConfig.autoTakeUp.ticks > 0
        ? rigidHookshotConfig.autoTakeUp.ticks
        : 0;
  },
  isReelBlocked: (player, state, mode, ctx) =>
    isRigidReelBlocked(player, state, mode, ctx),
  modifyReelSpeed: (player, state, mode, baseSpeed) =>
    modifyRigidReelSpeed(player, state, mode, baseSpeed),
  onLengthChanged: (player, state, mode, prevLength, nextLength) =>
    onRigidLengthChanged(player, state, mode, prevLength, nextLength),
  onTick: (player, state, { activeReelMode }, ctx) =>
    onRigidTick(player, state, activeReelMode, ctx),
  formatHudText: (player, state, distance) =>
    formatRigidHudText(player, state, distance),
};
