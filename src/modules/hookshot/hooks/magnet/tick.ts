import { Vector3Utils } from "@minecraft/math";
import { Dimension, Player, system, Vector3 } from "@minecraft/server";
import { isInputButtonPressed, isSneakButtonPressed } from "addon-utils";
import { EPSILON, PLAYER_CHEST_HEIGHT_OFFSET } from "../../constants";
import {
  MAGNET_HEAD_STICK_RADIUS,
  MAGNET_STICK_ALIGN_TIMEOUT_TICKS,
  MAGNET_STICK_DAMPING_SPEED_THRESHOLD,
  MAGNET_STICK_LOCK_RADIUS,
  MAGNET_STICK_RAY_EXTRA_DISTANCE,
  MAGNET_STICK_SOUND_ID,
  magnetHookshotConfig,
} from "./config";
import {
  calculateMagnetEffectRatio,
  calculateMagnetFixedStickLocation,
  resolveMagnetContactAxis,
} from "./math";
import {
  MagnetForceMode,
  MagnetHookshotDefinition,
  MagnetHookshotState,
  MagnetSoundPlayer,
} from "./type";

function isMagnetBlockBroken(dimension: Dimension, blockPos: Vector3): boolean {
  try {
    const block = dimension.getBlock(blockPos);
    if (!block) return false;
    return block.isAir || block.isLiquid;
  } catch {
    return false;
  }
}

function resolveDesiredMagnetMode(player: Player): MagnetForceMode {
  let jumpPressed = false;
  let sneakPressed = false;
  try {
    jumpPressed = isInputButtonPressed(player, "Jump") || player.isJumping;
    sneakPressed = isSneakButtonPressed(player);
  } catch {
    return "none";
  }

  if (jumpPressed && sneakPressed) return "none";
  if (sneakPressed) return "attract";
  if (jumpPressed) return "repel";
  return "none";
}

function canStickAtCurrentPosition(
  player: Player,
  state: MagnetHookshotState,
  chestPos: Vector3,
): { canStick: boolean; contactDir: Vector3 } {
  const { dir: contactDir, surfaceDist } = resolveMagnetContactAxis(
    chestPos,
    state.anchor,
  );
  const headPos: Vector3 = {
    x: player.location.x,
    y: player.location.y + 1.62,
    z: player.location.z,
  };
  const headDist = Vector3Utils.distance(headPos, state.anchor);
  const feetDist = Vector3Utils.distance(player.location, state.anchor);

  let canStick =
    headDist <= MAGNET_HEAD_STICK_RADIUS ||
    feetDist <= MAGNET_HEAD_STICK_RADIUS;

  if (!canStick && Vector3Utils.magnitude(contactDir) > EPSILON) {
    try {
      const stickHit = player.dimension.getBlockFromRay(chestPos, contactDir, {
        maxDistance: surfaceDist + MAGNET_STICK_RAY_EXTRA_DISTANCE,
        includeLiquidBlocks: false,
        includePassableBlocks: false,
      });
      if (
        stickHit &&
        Math.floor(stickHit.block.x) === state.blockPos.x &&
        Math.floor(stickHit.block.y) === state.blockPos.y &&
        Math.floor(stickHit.block.z) === state.blockPos.z
      ) {
        canStick = true;
      }
    } catch {}
  }

  return { canStick, contactDir };
}

function clearMagnetStickState(state: MagnetHookshotState): void {
  state.isStuck = false;
  state.stuckPhase = undefined;
  state.stuckAlignTicks = 0;
  state.stuckLocation = undefined;
}

function updateMagnetStickState(
  player: Player,
  state: MagnetHookshotState,
  chestPos: Vector3,
  playSound: MagnetSoundPlayer,
): void {
  if (state.activeMode !== "attract") {
    clearMagnetStickState(state);
    return;
  }

  if (!state.isStuck) {
    const { canStick, contactDir } = canStickAtCurrentPosition(
      player,
      state,
      chestPos,
    );
    if (!canStick) return;

    state.isStuck = true;
    state.stuckPhase = "damping";
    state.stuckAlignTicks = 0;
    state.stuckLocation = calculateMagnetFixedStickLocation(
      state.anchor,
      contactDir,
    );
    playSound(player, MAGNET_STICK_SOUND_ID, 1.4);
    return;
  }

  if (state.stuckPhase === "damping") {
    const speed = Vector3Utils.magnitude(player.getVelocity());
    if (speed <= MAGNET_STICK_DAMPING_SPEED_THRESHOLD) {
      state.stuckPhase = "aligning";
      state.stuckAlignTicks = 0;
    }
    return;
  }

  const distToTarget = state.stuckLocation
    ? Vector3Utils.distance(player.location, state.stuckLocation)
    : 0;

  if (state.stuckPhase === "aligning") {
    state.stuckAlignTicks = (state.stuckAlignTicks ?? 0) + 1;
    if (
      distToTarget <= MAGNET_STICK_LOCK_RADIUS ||
      state.stuckAlignTicks >= MAGNET_STICK_ALIGN_TIMEOUT_TICKS
    ) {
      state.stuckPhase = "locked";
    }
    return;
  }

  // locked: 目標位置から 0.2m 超えて離れ かつ 吸着条件を外れた場合は通常吸引へ戻す
  if (distToTarget > MAGNET_STICK_LOCK_RADIUS) {
    const { canStick } = canStickAtCurrentPosition(player, state, chestPos);
    if (!canStick) {
      clearMagnetStickState(state);
    }
  }
}

/**
 * マグネットフックの毎Tick状態更新（ブロック検証・入力・吸着固定・稼働音）を行います。
 */
export function stepMagnetState(
  player: Player,
  state: MagnetHookshotState,
  def: Omit<MagnetHookshotDefinition, "calculateImpulse">,
  playSound: MagnetSoundPlayer,
): boolean {
  if (state.anchor.dimensionId !== player.dimension.id) {
    return false;
  }
  if (isMagnetBlockBroken(player.dimension, state.blockPos)) {
    return false;
  }

  const desiredMode = resolveDesiredMagnetMode(player);
  if (desiredMode !== "none") {
    state.canAutoDetachOnGround = true;
  } else if (state.canAutoDetachOnGround && player.isOnGround) {
    return false;
  }

  const prevMode = state.activeMode;
  state.activeMode = desiredMode;
  if (desiredMode === "attract") {
    state.isModeEntryTick = prevMode !== "attract";
    state.attractHoldTicks =
      prevMode !== "attract" ? 0 : (state.attractHoldTicks ?? 0) + 1;
    state.repelHoldTicks = 0;
  } else if (desiredMode === "repel") {
    state.attractHoldTicks = 0;
    state.repelHoldTicks =
      prevMode !== "repel" ? 0 : (state.repelHoldTicks ?? 0) + 1;
    const cooldown = def.physics.repelBurstCooldownTicks;
    const lastBurst = state.lastRepelBurstTick ?? -cooldown;
    const canBurst =
      prevMode !== "repel" && system.currentTick - lastBurst >= cooldown;
    state.isModeEntryTick = canBurst;
    if (canBurst) {
      state.lastRepelBurstTick = system.currentTick;
    }
  } else {
    state.isModeEntryTick = false;
    state.attractHoldTicks = 0;
    state.repelHoldTicks = 0;
  }

  const chestPos: Vector3 = {
    x: player.location.x,
    y: player.location.y + PLAYER_CHEST_HEIGHT_OFFSET,
    z: player.location.z,
  };

  updateMagnetStickState(player, state, chestPos, playSound);

  if (state.activeMode !== "none") {
    const dist = Vector3Utils.distance(chestPos, state.anchor);
    const effectRatio = calculateMagnetEffectRatio(dist, def.physics);
    if (effectRatio > 0) {
      const lastTick =
        state.lastActiveSoundTick ?? -def.activeSound.intervalTicks;
      if (system.currentTick - lastTick >= def.activeSound.intervalTicks) {
        const pitch = state.activeMode === "attract" ? 1.15 : 0.85;
        playSound(player, def.activeSound.soundId, pitch);
        state.lastActiveSoundTick = system.currentTick;
      }
    }
  }

  return true;
}

export function onMagnetImpulseApplied(
  player: Player,
  state: MagnetHookshotState,
  impulse: Vector3,
): void {
  if (
    (impulse.x !== 0 || impulse.y !== 0 || impulse.z !== 0) &&
    state.activeMode === "repel" &&
    state.isModeEntryTick &&
    impulse.y >= magnetHookshotConfig.physics.repelSlowFallMinImpulseY
  ) {
    try {
      player.addEffect("slow_falling", 1, {
        amplifier: 0,
        showParticles: false,
      });
    } catch {}
  }
}

export function formatMagnetHudText(
  _player: Player,
  state: MagnetHookshotState,
  distance: number,
): string {
  const effectRatio = calculateMagnetEffectRatio(
    distance,
    magnetHookshotConfig.physics,
  );
  const effectPercent = Math.round(effectRatio * 100);
  const modeText =
    state.activeMode === "attract"
      ? state.isStuck
        ? state.stuckPhase === "damping"
          ? "吸着S1:減速(Shift)"
          : state.stuckPhase === "aligning"
            ? "吸着S2:面寄せ(Shift)"
            : "吸着S3:固定(Shift)"
        : "吸引(Shift)"
      : state.activeMode === "repel"
        ? "反発(Jump)"
        : effectRatio <= 0
          ? "待機ゾーン"
          : "待機";
  return `${distance.toFixed(1)}m (効果 ${effectPercent}%) | ${modeText}`;
}
