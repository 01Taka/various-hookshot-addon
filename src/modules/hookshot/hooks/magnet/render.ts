import { Vector3Utils } from "@minecraft/math";
import { MolangVariableMap, Player, system, Vector3 } from "@minecraft/server";
import {
  BlockOutlineRenderer,
  LineRenderer,
  MAGNET_ATTRACT_OUTLINE_STYLE,
  MAGNET_ATTRACT_WIRE_STYLE,
  MAGNET_GUIDE_WIRE_STYLE,
  MAGNET_NODE_OUTLINE_STYLE,
  MAGNET_REPEL_OUTLINE_STYLE,
  MAGNET_REPEL_WIRE_STYLE,
} from "../../../render";
import {
  MAGNET_CHARGE_INTERVAL_TICKS,
  MAGNET_CHARGE_PARTICLE_ID,
} from "./config";
import { MagnetHookshotState } from "./type";

/**
 * マグネットフックの視覚演出（ガイド4点・ブロック枠線・発動中帯電パーティクル）を描画します。
 */
export function renderMagnetHookshot(
  player: Player,
  state: MagnetHookshotState,
): void {
  const guideParticleId =
    state.activeMode === "attract"
      ? MAGNET_ATTRACT_WIRE_STYLE.particleId
      : state.activeMode === "repel"
        ? MAGNET_REPEL_WIRE_STYLE.particleId
        : MAGNET_GUIDE_WIRE_STYLE.particleId;

  const playerSidePos = LineRenderer.getHandPosition(player);
  const diff = Vector3Utils.subtract(state.anchor, playerSidePos);
  const dist = Vector3Utils.magnitude(diff);

  if (dist > 0.4) {
    const toAnchor = Vector3Utils.scale(diff, 1 / dist);
    const toPlayer = Vector3Utils.scale(toAnchor, -1);

    const points: Vector3[] = [
      Vector3Utils.add(
        playerSidePos,
        Vector3Utils.scale(toAnchor, Math.min(0.6, dist * 0.15)),
      ),
      Vector3Utils.add(
        playerSidePos,
        Vector3Utils.scale(toAnchor, Math.min(1.4, dist * 0.35)),
      ),
      Vector3Utils.add(
        state.anchor,
        Vector3Utils.scale(toPlayer, Math.min(1.0, dist * 0.25)),
      ),
      Vector3Utils.add(
        state.anchor,
        Vector3Utils.scale(toPlayer, Math.min(2.0, dist * 0.45)),
      ),
    ];

    for (const pos of points) {
      try {
        player.dimension.spawnParticle(guideParticleId, pos);
      } catch {}
    }
  }

  const outlineStyle =
    state.activeMode === "attract"
      ? MAGNET_ATTRACT_OUTLINE_STYLE
      : state.activeMode === "repel"
        ? MAGNET_REPEL_OUTLINE_STYLE
        : MAGNET_NODE_OUTLINE_STYLE;

  BlockOutlineRenderer.drawBlockOutline(
    player.dimension,
    state.blockPos,
    outlineStyle,
  );

  if (
    state.activeMode !== "none" &&
    system.currentTick % MAGNET_CHARGE_INTERVAL_TICKS === 0
  ) {
    const color = outlineStyle.color;
    const molangVars = new MolangVariableMap();
    if (color) {
      molangVars.setFloat("variable.color_r", color.r);
      molangVars.setFloat("variable.color_g", color.g);
      molangVars.setFloat("variable.color_b", color.b);
      molangVars.setFloat("variable.color_a", color.a ?? 0.95);
    }
    try {
      player.dimension.spawnParticle(
        MAGNET_CHARGE_PARTICLE_ID,
        state.anchor,
        molangVars,
      );
    } catch {}
  }
}
