import { world } from "@minecraft/server";
import { PlayerStateManager } from "addon-utils";
import { initHookshotSystem } from "./modules/hookshot";

// プレイヤー切断時の状態自動クリーンアップを登録
PlayerStateManager.registerAutoCleanup();

world.afterEvents.worldLoad.subscribe(() => {
  world.sendMessage("[Various Hookshot Addon] loaded");
});

// フックショットシステム初期化（リード: 伸縮フックショット、糸: 伸びないフックショット）
initHookshotSystem();
