import { ELASTIC_WIRE_STYLE } from "../../render";
import { calculateElasticHookshot } from "../math/elastic-math";
import { HookshotDefinition } from "../types";

export const ELASTIC_HOOKSHOT_ID = "elastic";
export const LEAD_ITEM_ID = "various_hookshot_addon:elastic_hookshot";

/**
 * リード（minecraft:lead）を使用した伸縮性（ゴム紐）フックショットの定義
 * 空中ジャンプ入力で短く（shorten）、シフト入力で長く（extend）
 * 空中ジャンプ短縮＋横向き視線でパスファインダー型スリングショット旋回軌道に対応
 */
export const elasticHookshotDefinition: HookshotDefinition = {
  id: ELASTIC_HOOKSHOT_ID,
  itemTypeId: LEAD_ITEM_ID,
  maxDistance: 250,
  reel: {
    mode: "continuous",
    speed: 1.5,
    initialDelta: 3.0,
    soundId: "step.cloth",
    soundIntervalTicks: 4,
  },
  reelMode: "shorten",
  minRopeLength: 1.5,
  raycastGraceTicks: 10,
  shotSoundId: "armor.equip_leather",
  hitSoundId: "leashknot.place",
  missSoundId: "leashknot.break",
  wireStyle: ELASTIC_WIRE_STYLE,
  enableGazeSteering: true,
  calculateImpulse: (player, state) => {
    return calculateElasticHookshot(player, state.anchor, {
      naturalLength: state.currentLength,
      maxLength: Math.max(250, state.currentLength * 1.5),
      isReelingIn: state.isReelingIn,
      enableSteering: true,
    });
  },
};
