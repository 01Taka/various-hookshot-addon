import { BAMBOO_WIRE_STYLE } from "../../render";
import { calculateBambooVaultHookshot } from "../math/bamboo-vault-math";
import { HookshotDefinition } from "../types";

export const BAMBOO_HOOKSHOT_ID = "bamboo";
export const BAMBOO_ITEM_ID = "minecraft:bamboo";

/**
 * 竹（minecraft:bamboo）を使用したしなる棒高跳び（ポールヴォールト）フックショットの定義
 * 走る勢いを棒のしなりで上方・前方への大跳躍へと変換する
 * 空中ジャンプ入力で短く（shorten）、シフト入力で長く（extend）
 */
export const bambooHookshotDefinition: HookshotDefinition = {
  id: BAMBOO_HOOKSHOT_ID,
  itemTypeId: BAMBOO_ITEM_ID,
  maxDistance: 40,
  reelSpeed: 1.2,
  reelMode: "shorten",
  initialReelDelta: 1.5,
  minRopeLength: 1.5,
  wireStyle: BAMBOO_WIRE_STYLE,
  calculateImpulse: (player, state) => {
    return calculateBambooVaultHookshot(player, state.anchor, {
      naturalLength: state.currentLength,
      surfaceNormal: state.normal,
    });
  },
};
