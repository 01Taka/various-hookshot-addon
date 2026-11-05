import { Player, system } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { ExplosionSupportSystem } from "./explosion-support-system";

/**
 * 爆発サポート設定用 UI（ModalFormData）を表示します
 */
export function openExplosionSettingForm(player: Player): void {
  if (!player.isValid) return;

  const currentStatus = ExplosionSupportSystem.isEnabled(player);

  const form = new ModalFormData();
  form.title("§l爆発サポート設定");
  form.toggle(
    "§e爆発サポートシステム§r\n(左クリックで足元爆発＆上昇・落下無効)",
    { defaultValue: currentStatus },
  );

  form
    .show(player)
    .then((response) => {
      if (response.canceled || !response.formValues) return;
      const newStatus = Boolean(response.formValues[0]);
      ExplosionSupportSystem.setEnabled(player, newStatus);

      if (newStatus) {
        player.sendMessage("§a[爆発サポート] 有効 (ON) に設定しました。");
        player.onScreenDisplay.setActionBar("§a爆発サポート: ON");
        player.playSound("random.orb", { pitch: 1.5 });
      } else {
        player.sendMessage("§c[爆発サポート] 無効 (OFF) に設定しました。");
        player.onScreenDisplay.setActionBar("§c爆発サポート: OFF");
        player.playSound("random.orb", { pitch: 0.8 });
      }
    })
    .catch(() => {});
}

/**
 * /scriptevent コマンドによる ONOFF 設定の初期化
 * - `/scriptevent hookshot:explosion` : トグル (ON ⇔ OFF)
 * - `/scriptevent hookshot:explosion on` / `off` : 明示的設定
 * - `/scriptevent hookshot:explosion menu` : 設定画面 (フォームUI) を開く
 */
export function initExplosionScriptEvents(): void {
  system.afterEvents.scriptEventReceive.subscribe((event) => {
    const validIds = ["hookshot:explosion", "es", "explosion"];
    if (!validIds.includes(event.id)) return;

    const entity = event.sourceEntity;
    if (!entity || entity.typeId !== "minecraft:player") return;
    const player = entity as Player;
    if (!player.isValid) return;

    const msg = event.message.trim().toLowerCase();

    if (msg === "" || msg === "toggle") {
      const nextState = ExplosionSupportSystem.toggleEnabled(player);
      if (nextState) {
        player.sendMessage(
          "§a[爆発サポート] §lON§r§a (有効) に切り替えました。",
        );
        player.onScreenDisplay.setActionBar("§a爆発サポート: ON");
        player.playSound("random.orb", { pitch: 1.5 });
      } else {
        player.sendMessage(
          "§c[爆発サポート] §lOFF§r§c (無効) に切り替えました。",
        );
        player.onScreenDisplay.setActionBar("§c爆発サポート: OFF");
        player.playSound("random.orb", { pitch: 0.8 });
      }
      return;
    }

    if (
      msg === "on" ||
      msg === "1" ||
      msg === "enable" ||
      msg === "true"
    ) {
      ExplosionSupportSystem.setEnabled(player, true);
      player.sendMessage("§a[爆発サポート] §lON§r§a (有効) に設定しました。");
      player.onScreenDisplay.setActionBar("§a爆発サポート: ON");
      player.playSound("random.orb", { pitch: 1.5 });
    } else if (
      msg === "off" ||
      msg === "0" ||
      msg === "disable" ||
      msg === "false"
    ) {
      ExplosionSupportSystem.setEnabled(player, false);
      player.sendMessage("§c[爆発サポート] §lOFF§r§c (無効) に設定しました。");
      player.onScreenDisplay.setActionBar("§c爆発サポート: OFF");
      player.playSound("random.orb", { pitch: 0.8 });
    } else if (
      msg === "menu" ||
      msg === "ui" ||
      msg === "setting" ||
      msg === "form"
    ) {
      openExplosionSettingForm(player);
    } else {
      player.sendMessage("§e=== 爆発サポート コマンド一覧 ===");
      player.sendMessage("§b/scriptevent hookshot:explosion§r : ON / OFF 切り替え");
      player.sendMessage("§b/scriptevent hookshot:explosion on|off§r : 明示的設定");
      player.sendMessage("§b/scriptevent hookshot:explosion menu§r : 設定画面を開く");
    }
  });
}
