import { world } from "@minecraft/server";
import { PlayerStateManager } from "addon-utils";
import { initExplosionSupportSystem } from "./modules/explosion-support";
import { initHookshotSystem } from "./modules/hookshot";
import { initHookshotHudSystem } from "./modules/hud";
import { AeroVestSystem } from "./modules/aero-vest";

// プレイヤー切断時の状態自動クリーンアップを登録
PlayerStateManager.registerAutoCleanup();

world.afterEvents.worldLoad.subscribe(() => {
  world.sendMessage("[Various Hookshot Addon] loaded");
});

// エアロベスト（慣性飛行）システム初期化
AeroVestSystem.init();

// 通常フックショットシステム初期化（リード: 伸縮、糸: 剛体、棒: ロッド、スライムボール: ばね、竹: 棒高跳びポール）
initHookshotSystem();

// アクションバーHUDシステム初期化（将来削除予定のため独立モジュール化）
initHookshotHudSystem();

// 爆発サポートシステム初期化（左クリックで足元爆発・落下相殺・上昇・落下耐性）
initExplosionSupportSystem();
