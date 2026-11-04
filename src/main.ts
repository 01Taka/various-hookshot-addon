import { world } from "@minecraft/server";
import { PlayerStateManager } from "addon-utils";
import { initHookshotSystem } from "./modules/hookshot";
import { initPathfinderGrapple } from "./modules/pathfinder-grapple";

// プレイヤー切断時の状態自動クリーンアップを登録
PlayerStateManager.registerAutoCleanup();

world.afterEvents.worldLoad.subscribe(() => {
  world.sendMessage("[Various Hookshot Addon] loaded");
});

// 通常フックショットシステム初期化（リード: 伸縮、糸: 剛体、棒: ロッド、スライムボール: ばね）
initHookshotSystem();

// パスファインダー型グラップル初期化（鉄インゴット: 独立した視線ステアリング・スリングショット）
initPathfinderGrapple();
