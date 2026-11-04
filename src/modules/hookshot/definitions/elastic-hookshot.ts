import { calculateElasticHookshot } from "../math/elastic-math";
import { HookshotDefinition } from "../types";

export const ELASTIC_HOOKSHOT_ID = "elastic";
export const LEAD_ITEM_ID = "minecraft:lead";

/**
 * リード（minecraft:lead）を使用した伸縮性（ゴム紐）フックショットの定義
 * 空中ジャンプ入力でゴム紐が縮む（shorten）
 */
export const elasticHookshotDefinition: HookshotDefinition = {
  id: ELASTIC_HOOKSHOT_ID,
  itemTypeId: LEAD_ITEM_ID,
  maxDistance: 250,
  reelSpeed: 2.0,
  reelMode: "shorten",
  minRopeLength: 1.5,
  calculateImpulse: (player, state) => {
    return calculateElasticHookshot(player, state.anchor, {
      naturalLength: state.currentLength,
      maxLength: Math.max(200, state.currentLength * 1.5),
    });
  },
};
