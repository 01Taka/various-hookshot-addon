import { ELASTIC_WIRE_STYLE } from "../../render";
import { calculateElasticHookshot } from "../math/elastic-math";
import { HookshotDefinition } from "../types";

export const ELASTIC_HOOKSHOT_ID = "elastic";
export const LEAD_ITEM_ID = "minecraft:lead";

/**
 * リード（minecraft:lead）を使用した伸縮性（ゴム紐）フックショットの定義
 * 空中ジャンプ入力で短く（shorten）、シフト入力で長く（extend）
 * 空中ジャンプ短縮＋横向き視線でパスファインダー型スリングショット旋回軌道に対応
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
  enableGazeSteering: true,
  enablePostFlight: true,
  calculateImpulse: (player, state) => {
    return calculateElasticHookshot(player, state.anchor, {
      naturalLength: state.currentLength,
      maxLength: Math.max(250, state.currentLength * 1.5),
      isReelingIn: state.isReelingIn,
      enableSteering: true,
    });
  },
};
