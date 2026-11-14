import { ELASTIC_WIRE_STYLE } from "../../render";
import { calculateElasticHookshot } from "../math/elastic-math";
import { canUseGazeSteering } from "../math/steering-math";
import { HookshotDefinition } from "../types";

export const ELASTIC_HOOKSHOT_ID = "elastic";
export const LEAD_ITEM_ID = "various_hookshot_addon:elastic_hookshot";

/**
 * リード（minecraft:lead）を使用した伸縮性（ゴム紐）フックショットの定義
 * 空中ジャンプ入力でゴムを巻き取り張力（stretch）をチャージし、
 * 離した瞬間に溜まったエネルギーを一気に解放してパチンコのように射出します。
 * エアロベスト装備時は前後入力（W/S）でチャージと巻き取り移動の配分を調整できます。
 */
export const elasticHookshotDefinition: HookshotDefinition = {
  id: ELASTIC_HOOKSHOT_ID,
  itemTypeId: LEAD_ITEM_ID,
  maxDistance: 250,
  reel: {
    mode: "continuous",
    speed: 1.5,
    initialDelta: 0.0,
    soundId: "step.cloth",
    soundIntervalTicks: 4,
  },
  reelMode: "shorten",
  minRopeLength: 1.5,
  raycastGraceTicks: 10,
  shotSoundId: "armor.equip_leather",
  hitSoundId: "leashknot.place",
  missSoundId: "leashknot.break",
  releaseSoundId: "random.bow",
  minReleaseStretch: 5.0,
  wireStyle: ELASTIC_WIRE_STYLE,
  enableGazeSteering: false,
  formatDistanceUi: (_player, state, distance) => {
    const stretch = Math.max(0, distance - state.currentLength);
    const prefix = state.isReelingIn ? "[溜め] " : "";
    const stretchSuffix = stretch > 0.1 ? ` (+${stretch.toFixed(1)}m)` : "";
    return `${prefix}${distance.toFixed(1)}m / ${state.currentLength.toFixed(1)}m${stretchSuffix}`;
  },
  calculateImpulse: (player, state) => {
    return calculateElasticHookshot(player, state.anchor, {
      naturalLength: state.currentLength,
      maxLength: Math.max(250, state.currentLength * 1.5),
      isReelingIn: state.isReelingIn,
      isChargeReleasing: state.isChargeReleasing,
      enableInputChargeControl: canUseGazeSteering(player),
    });
  },
};
