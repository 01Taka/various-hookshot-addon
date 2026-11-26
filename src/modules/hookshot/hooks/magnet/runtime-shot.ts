import { BlockRaycastHit, Player, Vector3 } from "@minecraft/server";
import { AnchorPosition, HookshotContext } from "../../types";
import { magnetHookshotConfig } from "./config";
import {
  MAGNET_HOOKSHOT_ID,
  MagnetHookshotDefinition,
  MagnetHookshotState,
} from "./type";

/**
 * ブロックヒット情報からマグネットフックの初期状態を生成します。
 */
export function createMagnetStateFromHit(
  player: Player,
  hit: BlockRaycastHit,
): MagnetHookshotState {
  const bx = Math.floor(hit.block.x);
  const by = Math.floor(hit.block.y);
  const bz = Math.floor(hit.block.z);
  const blockPos: Vector3 = { x: bx, y: by, z: bz };
  const anchor: AnchorPosition = {
    dimensionId: player.dimension.id,
    x: bx + 0.5,
    y: by + 0.5,
    z: bz + 0.5,
  };

  return {
    hookshotId: MAGNET_HOOKSHOT_ID,
    slotIndex: player.selectedSlotIndex,
    anchor,
    currentLength: 0,
    blockPos,
    activeMode: "none",
    canAutoDetachOnGround: false,
    isStuck: false,
  };
}

export function shotMagnet(
  player: Player,
  def: Omit<MagnetHookshotDefinition, "calculateImpulse">,
  ctx: HookshotContext,
  isAlreadyActive: boolean,
): boolean {
  if (!player.isValid) return false;

  let hit: BlockRaycastHit | undefined;
  try {
    hit = player.getBlockFromViewDirection({
      maxDistance: def.maxDistance,
      includeLiquidBlocks: false,
      includePassableBlocks: false,
    });
  } catch {
    hit = undefined;
  }

  if (!hit) {
    if (isAlreadyActive) {
      ctx.unhook(player);
    } else {
      ctx.playSound(player, def.missSoundId);
    }
    return false;
  }

  const newState = createMagnetStateFromHit(player, hit);
  ctx.setActiveState(player, newState);
  ctx.playSound(player, def.shotSoundId);
  ctx.playSound(player, def.hitSoundId);
  ctx.consumeDurability(player, def.itemTypeId, newState.slotIndex);
  return true;
}

export function onMagnetShot(player: Player, ctx: HookshotContext): boolean {
  return shotMagnet(player, magnetHookshotConfig, ctx, false);
}

export function onMagnetToggleWhileActive(
  player: Player,
  ctx: HookshotContext,
): boolean {
  shotMagnet(player, magnetHookshotConfig, ctx, true);
  return true;
}
