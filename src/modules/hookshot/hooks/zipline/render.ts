import { Player, Vector3 } from "@minecraft/server";
import {
  BlockOutlineRenderer,
  LineRenderer,
  ZIPLINE_PILLAR_STYLE,
  ZIPLINE_RAIL_STYLE,
  ZIPLINE_SUPPORT_OUTLINE_STYLE,
  ZIPLINE_WIRE_STYLE,
} from "../../../render";
import { ziplineHookshotConfig } from "./config";
import { ZiplineHookshotState } from "./type";

/**
 * ジップライン専用の3要素（土台＋支柱、レール、吊り下げ鎖）を描画します。
 */
export function renderZiplineHookshot(
  player: Player,
  state: ZiplineHookshotState,
): number {
  if (!player.isValid) return 0;

  const dimension = player.dimension;
  const dimensionId = dimension.id;
  const torsoHeightOffset = ziplineHookshotConfig.railPhysics.torsoHeightOffset;
  const visualChainLength = Math.max(
    0.5,
    state.currentLength - torsoHeightOffset,
  );
  let total = 0;

  // 0. 支持ブロック（始点・終点）の枠線ハイライト
  total += BlockOutlineRenderer.drawBlockOutlines(
    dimension,
    [state.startSupportBlock, state.endSupportBlock],
    ZIPLINE_SUPPORT_OUTLINE_STYLE,
  );

  // 1. 土台＋支柱（始点地面〜支柱頂点）
  total += LineRenderer.drawWire(dimension, {
    dimensionId,
    start: state.railBase,
    end: state.railStart,
    style: ZIPLINE_PILLAR_STYLE,
  });

  // 1b. 終点側支柱（終点地面に支柱が立った場合、または壁・天井の0.5m杭）
  if (state.endRailBase) {
    total += LineRenderer.drawWire(dimension, {
      dimensionId,
      start: state.endRailBase,
      end: state.endRailTop ?? state.railEnd,
      style: ZIPLINE_PILLAR_STYLE,
    });
  }

  // 2. レール（支柱頂点〜着弾終点）
  total += LineRenderer.drawWire(dimension, {
    dimensionId,
    start: state.railStart,
    end: state.railEnd,
    viewerPosition: player.location,
    style: ZIPLINE_RAIL_STYLE,
  });

  // 3. 吊り下げ鎖（可動アンカー〜プレイヤー胴）
  const torsoPos: Vector3 = {
    x: player.location.x,
    y: player.location.y + torsoHeightOffset,
    z: player.location.z,
  };
  total += LineRenderer.drawWire(dimension, {
    dimensionId,
    start: torsoPos,
    end: state.anchor,
    currentLength: visualChainLength,
    style: ziplineHookshotConfig.wireStyle ?? ZIPLINE_WIRE_STYLE,
  });

  // 4. メインの紐とチェーンの接続点（滑車パーティクル）
  try {
    dimension.spawnParticle(
      "various_hookshot_addon:zipline_anchor",
      state.anchor,
    );
    total++;
  } catch {}

  return total;
}
