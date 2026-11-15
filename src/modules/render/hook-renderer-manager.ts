import { Player, system, Vector3 } from "@minecraft/server";
import { LineRenderer } from "./line-renderer";
import { WireStyle } from "./types";
import {
  ELASTIC_WIRE_STYLE,
  RIGID_WIRE_STYLE,
  ROD_WIRE_STYLE,
  SPRING_WIRE_STYLE,
} from "./wire-styles";

const DEFAULT_STYLES_BY_ID: Record<string, WireStyle> = {
  elastic: ELASTIC_WIRE_STYLE,
  rigid: RIGID_WIRE_STYLE,
  rod: ROD_WIRE_STYLE,
  spring: SPRING_WIRE_STYLE,
};

export class HookRenderManager {
  /**
   * プレイヤーとアンカー位置を結ぶワイヤーを描画します。
   */
  public static render(
    player: Player,
    anchor: Vector3,
    style: WireStyle,
    currentLength?: number,
    normal?: Vector3,
    extraCharge?: number,
  ): number {
    if (!player.isValid) return 0;

    const start = LineRenderer.getHandPosition(player);
    const count = LineRenderer.drawWire(player.dimension, {
      dimensionId: player.dimension.id,
      start,
      end: anchor,
      normal,
      currentLength,
      extraCharge,
      style,
    });

    if (system.currentTick % 10 === 0) {
      player.sendMessage(`[Debug] Particles: ${count}`);
    }

    return count;
  }

  /**
   * フックショットIDに対応するスタイルを解決して描画します。
   */
  public static renderHookshot(
    player: Player,
    anchor: Vector3,
    hookshotId: string,
    customStyle?: WireStyle,
    currentLength?: number,
    normal?: Vector3,
    extraCharge?: number,
  ): number {
    const style =
      customStyle ?? DEFAULT_STYLES_BY_ID[hookshotId] ?? RIGID_WIRE_STYLE;
    return this.render(player, anchor, style, currentLength, normal, extraCharge);
  }
}
