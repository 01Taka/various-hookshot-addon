import { Player, Vector3 } from "@minecraft/server";
import { BlockOutlineRenderer } from "./block-outline-renderer";
import { LineRenderer } from "./line-renderer";
import { WireStyle } from "./types";
import {
  ELASTIC_WIRE_STYLE,
  RIGID_WIRE_STYLE,
  ROD_WIRE_STYLE,
  SPRING_WIRE_STYLE,
  ZIPLINE_PILLAR_STYLE,
  ZIPLINE_RAIL_STYLE,
  ZIPLINE_SUPPORT_OUTLINE_STYLE,
  ZIPLINE_WIRE_STYLE,
} from "./wire-styles";

const DEFAULT_STYLES_BY_ID: Record<string, WireStyle> = {
  elastic: ELASTIC_WIRE_STYLE,
  rigid: RIGID_WIRE_STYLE,
  rod: ROD_WIRE_STYLE,
  spring: SPRING_WIRE_STYLE,
  zipline: ZIPLINE_WIRE_STYLE,
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
    fixedThicknessScore?: number,
  ): number {
    const style =
      customStyle ?? DEFAULT_STYLES_BY_ID[hookshotId] ?? RIGID_WIRE_STYLE;
    return this.render(
      player,
      anchor,
      style,
      currentLength,
      normal,
      extraCharge,
      fixedThicknessScore,
    );
  }

  /**
   * ジップライン専用の3要素（土台＋支柱、レール、吊り下げ鎖）を描画します。
   */
  public static renderZipline(
    player: Player,
    params: {
      railBase: Vector3;
      endRailBase?: Vector3;
      endRailTop?: Vector3;
      railStart: Vector3;
      railEnd: Vector3;
      startSupportBlock: Vector3;
      endSupportBlock: Vector3;
      anchor: Vector3;
      visualChainLength: number;
      torsoHeightOffset: number;
      chainStyle?: WireStyle;
    },
  ): number {
    if (!player.isValid) return 0;

    const dimension = player.dimension;
    const dimensionId = dimension.id;
    let total = 0;

    // 0. 支持ブロック（始点・終点）の枠線ハイライト
    total += BlockOutlineRenderer.drawBlockOutlines(
      dimension,
      [params.startSupportBlock, params.endSupportBlock],
      ZIPLINE_SUPPORT_OUTLINE_STYLE,
    );

    // 1. 土台＋支柱（始点地面〜支柱頂点）
    total += LineRenderer.drawWire(dimension, {
      dimensionId,
      start: params.railBase,
      end: params.railStart,
      style: ZIPLINE_PILLAR_STYLE,
    });

    // 1b. 終点側支柱（終点地面に支柱が立った場合、または壁・天井の0.5m杭）
    if (params.endRailBase) {
      total += LineRenderer.drawWire(dimension, {
        dimensionId,
        start: params.endRailBase,
        end: params.endRailTop ?? params.railEnd,
        style: ZIPLINE_PILLAR_STYLE,
      });
    }

    // 2. レール（支柱頂点〜着弾終点）
    total += LineRenderer.drawWire(dimension, {
      dimensionId,
      start: params.railStart,
      end: params.railEnd,
      viewerPosition: player.location,
      style: ZIPLINE_RAIL_STYLE,
    });

    // 3. 吊り下げ鎖（可動アンカー〜プレイヤー胴）
    const torsoPos: Vector3 = {
      x: player.location.x,
      y: player.location.y + params.torsoHeightOffset,
      z: player.location.z,
    };
    total += LineRenderer.drawWire(dimension, {
      dimensionId,
      start: torsoPos,
      end: params.anchor,
      currentLength: params.visualChainLength,
      style: params.chainStyle ?? ZIPLINE_WIRE_STYLE,
    });

    // 4. メインの紐とチェーンの接続点（暗いグレーの滑車パーティクル）
    try {
      dimension.spawnParticle(
        "various_hookshot_addon:zipline_anchor",
        params.anchor,
      );
      total++;
    } catch {
      // 未ロードチャンク等でのエラー抑止
    }

    return total;
  }
}
