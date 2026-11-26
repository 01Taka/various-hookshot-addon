import { Vector3Utils } from "@minecraft/math";
import { Player, system, world } from "@minecraft/server";
import { PlayerStateManager } from "addon-utils";
import { EPSILON } from "../../constants";
import { BAMBOO_AIR_CHAIN_KEY, bambooHookshotConfig } from "./config";
import { BambooAirChainState, BambooHookshotState } from "./type";

interface BambooTautState {
  hasCompressed: boolean;
  isTaut: boolean;
}

const bambooTautStates = new Map<string, BambooTautState>();

let isTrackingInitialized = false;

/**
 * 竹フックショットの空中連続使用状態追跡（着地監視ループ）を初期化します。
 */
export function initBambooHookshotTracking(): void {
  if (isTrackingInitialized) return;
  isTrackingInitialized = true;

  system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
      if (!player.isValid) continue;

      const chain = PlayerStateManager.get<BambooAirChainState | null>(
        player.id,
        BAMBOO_AIR_CHAIN_KEY,
        null,
      );
      if (!chain) continue;

      const isGrounded =
        player.isOnGround || player.isInWater || player.isClimbing;

      if (!isGrounded) {
        if (!chain.hasBeenAirborne) {
          chain.hasBeenAirborne = true;
          PlayerStateManager.set(player.id, BAMBOO_AIR_CHAIN_KEY, chain);
        }
      } else {
        if (chain.isHooked && !chain.hasBeenAirborne) {
          continue;
        }
        PlayerStateManager.delete(player.id, BAMBOO_AIR_CHAIN_KEY);
      }
    }
  });
}

initBambooHookshotTracking();

/**
 * 圧縮状態から伸び切り（ピンと張った状態）へ移行した瞬間にSEを再生します。
 */
export function updateBambooTautSound(
  player: {
    id: string;
    location: { x: number; y: number; z: number };
    playSound: (id: string, opts?: { volume?: number; pitch?: number }) => void;
  },
  anchor: { x: number; y: number; z: number },
  currentLength: number,
): void {
  const taut = bambooTautStates.get(player.id);
  if (!taut) return;

  const dist = Vector3Utils.distance(player.location, anchor);
  if (dist < currentLength) {
    taut.hasCompressed = true;
    taut.isTaut = false;
    return;
  }

  if (taut.hasCompressed && !taut.isTaut) {
    taut.isTaut = true;
    const { soundId, volume, pitch } = bambooHookshotConfig.tautSound;
    if (soundId) {
      try {
        player.playSound(soundId, { volume, pitch });
      } catch {}
    }
  }
}

export function onBambooAttach(
  player: Player,
  state: BambooHookshotState,
): void {
  const chain = PlayerStateManager.get<BambooAirChainState | null>(
    player.id,
    BAMBOO_AIR_CHAIN_KEY,
    null,
  );
  const airUses = chain?.count ?? 0;

  const vel = player.getVelocity();
  const toAnchor = Vector3Utils.subtract(state.anchor, player.location);
  const dist = Vector3Utils.magnitude(toAnchor);
  if (dist > EPSILON) {
    const dirToAnchor = Vector3Utils.scale(toAnchor, 1 / dist);

    const inwardXZ = Math.max(
      0,
      vel.x * dirToAnchor.x + vel.z * dirToAnchor.z,
    );
    const inwardY = Math.max(0, vel.y * dirToAnchor.y);

    const {
      speedFlexBonusFactorXZ,
      speedFlexBonusFactorY,
      maxSpeedFlexBonus,
      consecutiveAirBonusDecayRate,
    } = bambooHookshotConfig.airChainBonus;

    const rawBonus =
      inwardXZ * speedFlexBonusFactorXZ + inwardY * speedFlexBonusFactorY;
    if (rawBonus > 0) {
      let bonus = Math.min(rawBonus, maxSpeedFlexBonus);

      if (airUses > 0) {
        const decayRate = Math.max(
          0,
          Math.min(1, consecutiveAirBonusDecayRate),
        );
        bonus *= decayRate;
      }

      if (bonus > EPSILON) {
        state.currentLength += bonus;
      }
    }
  }

  bambooTautStates.set(player.id, {
    hasCompressed: false,
    isTaut: false,
  });
  PlayerStateManager.set(player.id, BAMBOO_AIR_CHAIN_KEY, {
    count: airUses + 1,
    isHooked: true,
    hasBeenAirborne: !player.isOnGround,
  });
}

export function onBambooDetach(player: Player): void {
  bambooTautStates.delete(player.id);
  const chain = PlayerStateManager.get<BambooAirChainState | null>(
    player.id,
    BAMBOO_AIR_CHAIN_KEY,
    null,
  );
  if (chain) {
    chain.isHooked = false;
    const isGrounded =
      player.isOnGround || player.isInWater || player.isClimbing;
    if (chain.hasBeenAirborne && isGrounded) {
      PlayerStateManager.delete(player.id, BAMBOO_AIR_CHAIN_KEY);
    } else {
      PlayerStateManager.set(player.id, BAMBOO_AIR_CHAIN_KEY, chain);
    }
  }
}
