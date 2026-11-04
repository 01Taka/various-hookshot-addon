import { ELASTIC_WIRE_STYLE } from "../../render";
import { calculateElasticHookshot } from "../math/elastic-math";
import { HookshotDefinition } from "../types";

export const ELASTIC_HOOKSHOT_ID = "elastic";
export const LEAD_ITEM_ID = "minecraft:lead";

/**
 * リード（minecraft:lead）を使用した伸縮性（ゴム紐）フックショットの定義
 * 空中ジャンプ入力で短く（shorten）、シフト入力で長く（extend）
 */
export const elasticHookshotDefinition: HookshotDefinition = {
  id: ELASTIC_HOOKSHOT_ID,
  itemTypeId: LEAD_ITEM_ID,
  maxDistance: 250,
  reelSpeed: 1.5,
  reelMode: "shorten",
  initialReelDelta: 3.0,
  minRopeLength: 1.5,
  wireStyle: ELASTIC_WIRE_STYLE,
  calculateImpulse: (player, state) => {
    return calculateElasticHookshot(player, state.anchor, {
      naturalLength: state.currentLength,
      maxLength: Math.max(250, state.currentLength * 1.5),
    });
  },
};
