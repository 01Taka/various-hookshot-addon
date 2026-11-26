import { world } from "@minecraft/server";
import { PlayerStateManager } from "addon-utils";
import { initHookshotSystem } from "./modules/hookshot";
import { initHookshotHudSystem } from "./modules/hud";
import { initSubItems } from "./modules/sub-items";

// プレイヤー切断時の状態自動クリーンアップを登録
PlayerStateManager.registerAutoCleanup();

world.afterEvents.worldLoad.subscribe(() => {
  world.sendMessage("[Various Hookshot Addon] loaded");
});

// 補助アイテムシステム初期化（エアロベスト・バーストチャージ）
initSubItems();

// 通常フックショットシステム初期化
initHookshotSystem();

// アクションバーHUDシステム初期化
initHookshotHudSystem();
