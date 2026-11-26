import { Vector3Utils } from "@minecraft/math";
import { Player, system, world } from "@minecraft/server";
import { getMainhandItem, PlayerStateManager } from "addon-utils";
import {
  HookshotDefinition,
  HookshotState,
  HookshotSystem,
  PendingRaycastState,
  TICKS_PER_SECOND,
} from "../hookshot";
import { formatHookshotDistanceText } from "./formatters";

const UI_ACTIVE_KEY = "hookshotUiActive";

/** 構え前プレビュー距離UIの最小レイキャスト距離 (blocks) */
const PREVIEW_MIN_RAYCAST_DISTANCE = 250;

/**
 * フックショットのアクションバーHUD表示を独立して管理するシステム。
 * フックショット本体（HookshotSystem）の公開状態を読み取って表示のみを担当します。
 */
export class HookshotHudSystem {
  private static isInitialized = false;

  public static init(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    system.runInterval(() => {
      for (const player of world.getAllPlayers()) {
        this.updatePlayerHud(player);
      }
    });
  }

  private static updatePlayerHud(player: Player): void {
    const state = HookshotSystem.getActiveState(player);
    if (!state) {
      const pending = HookshotSystem.getPendingRaycast(player);
      if (pending) {
        this.updatePendingRaycastUi(player, pending);
        return;
      }
      this.updatePreviewDistanceUi(player);
      return;
    }

    if (
      player.dimension.id !== state.anchor.dimensionId ||
      HookshotSystem.isStateRetracting(state)
    ) {
      this.clearDistanceUiIfActive(player);
      return;
    }

    const def = HookshotSystem.getDefinitionById(state.hookshotId);
    if (!def) {
      this.clearDistanceUiIfActive(player);
      return;
    }

    this.updateDistanceUi(player, state, def);
  }

  private static updatePendingRaycastUi(
    player: Player,
    pending: PendingRaycastState,
  ): void {
    const def = HookshotSystem.getDefinitionById(pending.hookshotId);
    if (!def) {
      this.clearDistanceUiIfActive(player);
      return;
    }

    try {
      player.onScreenDisplay.setActionBar(
        `[探索中] ${def.maxDistance.toFixed(1)}m (${pending.remainingTicks}t)`,
      );
      PlayerStateManager.set(player.id, UI_ACTIVE_KEY, true);
    } catch {
      // プレイヤー切断時などのエラー抑止
    }
  }

  private static updatePreviewDistanceUi(player: Player): void {
    const mainhandItem = getMainhandItem(player);
    if (!mainhandItem) {
      this.clearDistanceUiIfActive(player);
      return;
    }

    const def = HookshotSystem.getDefinitionByItem(mainhandItem.typeId);
    if (!def) {
      this.clearDistanceUiIfActive(player);
      return;
    }

    const maxDistance = def.maxDistance;
    const raycastDistance = Math.max(maxDistance, PREVIEW_MIN_RAYCAST_DISTANCE);

    const hit = player.getBlockFromViewDirection({
      maxDistance: raycastDistance,
      includeLiquidBlocks: false,
      includePassableBlocks: false,
    });

    if (!hit) {
      this.clearDistanceUiIfActive(player);
      return;
    }

    const anchor = HookshotSystem.calculateAnchorPosition(
      player.dimension.id,
      player.getHeadLocation(),
      player.getViewDirection(),
      hit,
    );
    const distance = Vector3Utils.distance(player.location, anchor);

    try {
      player.onScreenDisplay.setActionBar(
        `${distance.toFixed(1)}m / ${maxDistance.toFixed(1)}m`,
      );
      PlayerStateManager.set(player.id, UI_ACTIVE_KEY, true);
    } catch {
      // プレイヤー切断時などのエラー抑止
    }
  }

  private static updateDistanceUi(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
  ): void {
    try {
      if (!HookshotSystem.isStateAnchored(state)) {
        const maxLength = def.maxDistance;
        player.onScreenDisplay.setActionBar(
          `[構え] ${state.currentLength.toFixed(1)}m / ${maxLength.toFixed(1)}m`,
        );
      } else {
        const distance = Vector3Utils.distance(player.location, state.anchor);
        const speed = Vector3Utils.magnitude(player.getVelocity());
        const baseText = formatHookshotDistanceText(
          player,
          def,
          state,
          distance,
        );
        player.onScreenDisplay.setActionBar(
          `${baseText} | ${speed.toFixed(2)} b/t (${(speed * TICKS_PER_SECOND).toFixed(1)} m/s)`,
        );
      }
      PlayerStateManager.set(player.id, UI_ACTIVE_KEY, true);
    } catch {
      // プレイヤー切断時などのエラー抑止
    }
  }

  private static clearDistanceUiIfActive(player: Player): void {
    const isActive = PlayerStateManager.get<boolean>(
      player.id,
      UI_ACTIVE_KEY,
      false,
    );
    if (!isActive) return;

    PlayerStateManager.delete(player.id, UI_ACTIVE_KEY);
    try {
      player.onScreenDisplay.setActionBar("");
    } catch {}
  }
}
