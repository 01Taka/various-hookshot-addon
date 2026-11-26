import { Player, Vector3 } from "@minecraft/server";
import { LineRenderer } from "./line-renderer";
import { WireStyle } from "./types";
import { RIGID_WIRE_STYLE } from "./wire-styles";

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
    fixedThicknessScore?: number,
  ): number {
    if (!player.isValid) return 0;

    const start = LineRenderer.getHandPosition(player);
    return LineRenderer.drawWire(player.dimension, {
      dimensionId: player.dimension.id,
      start,
      end: anchor,
      normal,
      currentLength,
      extraCharge,
      fixedThicknessScore,
      style,
    });
  }

  /**
   * 指定スタイル（未指定時は標準ワイヤースタイル）でワイヤーを描画します。
   */
  public static renderHookshot(
    player: Player,
    anchor: Vector3,
    _hookshotId: string,
    customStyle?: WireStyle,
    currentLength?: number,
    normal?: Vector3,
    extraCharge?: number,
    fixedThicknessScore?: number,
  ): number {
    return this.render(
      player,
      anchor,
      customStyle ?? RIGID_WIRE_STYLE,
      currentLength,
      normal,
      extraCharge,
      fixedThicknessScore,
    );
  }
}
