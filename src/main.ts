import { world } from "@minecraft/server";
import { PlayerStateManager } from "addon-utils";
import { initExplosionSupportSystem } from "./modules/explosion-support";
import { initHookshotSystem } from "./modules/hookshot";
import { initPathfinderGrapple } from "./modules/pathfinder-grapple";

// プレイヤー切断時の状態自動クリーンアップを登録
PlayerStateManager.registerAutoCleanup();

world.afterEvents.worldLoad.subscribe(() => {
  world.sendMessage("[Various Hookshot Addon] loaded");
  world.sendMessage("§7地上でスニーク＋左クリック、または /scriptevent hookshot:explosion で爆発サポートのON/OFFを設定できます。");
});

// 通常フックショットシステム初期化（リード: 伸縮、糸: 剛体、棒: ロッド、スライムボール: ばね、竹: 棒高跳びポール）
initHookshotSystem();

// パスファインダー型グラップル初期化（鉄インゴット: 独立した視線ステアリング・スリングショット）
initPathfinderGrapple();

// 爆発サポートシステム初期化（左クリックで足元爆発・落下相殺・上昇・落下耐性）
initExplosionSupportSystem();
