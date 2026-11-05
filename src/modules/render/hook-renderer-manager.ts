import { Player, Vector3 } from "@minecraft/server";
import { LineRenderer } from "./line-renderer";
import { WireStyle } from "./types";
import {
  ELASTIC_WIRE_STYLE,
  PATHFINDER_WIRE_STYLE,
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
  ): void {
    if (!player.isValid) return;

    const start = LineRenderer.getHandPosition(player);
    LineRenderer.drawWire(player.dimension, {
      dimensionId: player.dimension.id,
      start,
      end: anchor,
      normal,
      currentLength,
      style,
    });
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
  ): void {
    const style =
      customStyle ?? DEFAULT_STYLES_BY_ID[hookshotId] ?? RIGID_WIRE_STYLE;
    this.render(player, anchor, style, currentLength, normal);
  }

  /**
   * パスファインダー型グラップルのワイヤーを描画します。
   */
  public static renderPathfinder(player: Player, anchor: Vector3): void {
    this.render(player, anchor, PATHFINDER_WIRE_STYLE);
  }
}
