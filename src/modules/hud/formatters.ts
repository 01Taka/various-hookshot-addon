import { Player } from "@minecraft/server";
import { HookshotDefinition, HookshotState } from "../hookshot";

/**
 * 接続中アクションバーの距離・状態テキストを種別ごとに整形します。
 */
export function formatHookshotDistanceText(
  player: Player,
  def: HookshotDefinition,
  state: HookshotState,
  distance: number,
): string {
  if (def.formatHudText) {
    return def.formatHudText(player, state, distance);
  }
  return `${distance.toFixed(1)}m / ${state.currentLength.toFixed(1)}m`;
}
