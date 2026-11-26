import { Player } from "@minecraft/server";
import { HookRenderManager } from "../../../render";
import { ziplineHookshotConfig } from "./config";
import { ZiplineHookshotState } from "./type";

export function renderZiplineHookshot(
  player: Player,
  state: ZiplineHookshotState,
): void {
  HookRenderManager.renderZipline(player, {
    railBase: state.railBase,
    endRailBase: state.endRailBase,
    endRailTop: state.endRailTop,
    railStart: state.railStart,
    railEnd: state.railEnd,
    startSupportBlock: state.startSupportBlock,
    endSupportBlock: state.endSupportBlock,
    anchor: state.anchor,
    visualChainLength: Math.max(
      0.5,
      state.currentLength - ziplineHookshotConfig.railPhysics.torsoHeightOffset,
    ),
    torsoHeightOffset: ziplineHookshotConfig.railPhysics.torsoHeightOffset,
    chainStyle: ziplineHookshotConfig.wireStyle,
  });
}
