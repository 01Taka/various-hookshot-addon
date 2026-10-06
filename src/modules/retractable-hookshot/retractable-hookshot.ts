import { Vector3Utils } from "@minecraft/math";
import { Player, system, Vector3, world } from "@minecraft/server";
import { isSneakButtonPressed, PlayerStateManager } from "addon-utils";
import { calculateRetractableHookshot } from "./retractable-hookshot-math.utils";

type AnchorPosition = Vector3 & { dimensionId: string };

const ANCHOR_POSITION_KEY = "retractableAnchorPosition";
const CURRENT_LENGTH_KEY = "retractableCurrentRopeLength";
export const FISHING_ROD_ID = "minecraft:fishing_rod";
export const MAX_RAYCAST_DISTANCE = 48;
export const REEL_IN_SPEED = 1.25; // 巻き取り速度 (blocks/tick = 5.0 blocks/s)
export const MIN_ROPE_LENGTH = 1.5; // 最小半径 (ブロックへの埋まり防止)

function shot(player: Player) {
  if (PlayerStateManager.has(player.id, ANCHOR_POSITION_KEY)) return;

  const hit = player.getBlockFromViewDirection({
    maxDistance: 90,
    includeLiquidBlocks: false,
    includePassableBlocks: false,
  });
  if (!hit) {
    return;
  }
  const anchor = {
    dimensionId: player.dimension.id,
    x: hit.block.x + 0.5,
    y: hit.block.y + 0.5,
    z: hit.block.z + 0.5,
  };

  PlayerStateManager.set(player.id, ANCHOR_POSITION_KEY, anchor);

  const distance = Vector3Utils.distance(player.location, anchor);
  // Math.max(
  //   Math.abs(player.location.y - anchor.y) - 1,
  //   MIN_ROPE_LENGTH,
  // )
  PlayerStateManager.set(player.id, CURRENT_LENGTH_KEY, distance);
  return anchor;
}

function unhook(player: Player) {
  PlayerStateManager.delete(player.id, ANCHOR_POSITION_KEY);
  PlayerStateManager.delete(player.id, CURRENT_LENGTH_KEY);
}

function toggleHook(player: Player) {
  if (PlayerStateManager.has(player.id, ANCHOR_POSITION_KEY)) {
    unhook(player);
  } else {
    shot(player);
  }
}

function reel(player: Player) {
  const anchor = PlayerStateManager.get<AnchorPosition | null>(
    player.id,
    ANCHOR_POSITION_KEY,
    null,
  );
  const currentLength = PlayerStateManager.get(
    player.id,
    CURRENT_LENGTH_KEY,
    null,
  );

  if (!anchor || !currentLength) return;

  const nextLength = Math.max(currentLength - REEL_IN_SPEED, MIN_ROPE_LENGTH);
  if (currentLength !== nextLength) {
    PlayerStateManager.set(player.id, CURRENT_LENGTH_KEY, nextLength);
  }
}

export function retractableHookshotMain() {
  world.afterEvents.itemUse.subscribe((event) => {
    const player = event.source;
    const item = event.itemStack;
    if (item.typeId !== FISHING_ROD_ID) return;
    toggleHook(player);
  });

  system.runInterval(() => {
    for (let player of world.getAllPlayers()) {
      const isReeling = isSneakButtonPressed(player);
      if (isReeling) {
        reel(player);
      }
      const anchor = PlayerStateManager.get<AnchorPosition | null>(
        player.id,
        ANCHOR_POSITION_KEY,
        null,
      );
      const currentLength = PlayerStateManager.get(
        player.id,
        CURRENT_LENGTH_KEY,
        null,
      );

      if (anchor && currentLength) {
        const impulse = calculateRetractableHookshot(
          player,
          anchor,
          currentLength,
        );
        player.applyImpulse(impulse);
      }
    }
  });
}
