import { system, world } from "@minecraft/server";
import { PlayerStateManager } from "addon-utils";
import { handleHookshotUse, tickHookshotPhysics } from "./modules/hookshot";
import { retractableHookshotMain } from "./modules/retractable-hookshot/retractable-hookshot";

// プレイヤー切断時の状態自動クリーンアップを登録
PlayerStateManager.registerAutoCleanup();

world.afterEvents.worldLoad.subscribe(() => {
  world.sendMessage("[Various Hookshot Addon] loaded");
});

// // 釣竿使用（右クリック）イベントリスナー
// world.afterEvents.itemUse.subscribe((event) => {
//   handleHookshotUse(event);
// });

// // 毎Tickの物理演算・拘束処理ループ
// system.runInterval(() => {
//   for (const player of world.getAllPlayers()) {
//     tickHookshotPhysics(player);
//   }
// }, 1);
retractableHookshotMain();
