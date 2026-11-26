import { InertiaFlightOptions } from "../../inertia-flight";

export const AERO_VEST_ITEM_ID = "various_hookshot_addon:aero_vest";
export const PHANTOM_AERO_VEST_ITEM_ID =
  "various_hookshot_addon:phantom_aero_vest";

/** 慣性飛行中の耐久消費間隔 (20 ticks = 1秒) */
export const AERO_VEST_DURABILITY_INTERVAL_TICKS = 20;

/** 装備中のエアロベストごとの慣性飛行パラメータ */
export const AERO_VEST_INERTIA_CONFIGS: Record<string, InertiaFlightOptions> = {
  [AERO_VEST_ITEM_ID]: {
    retentionXZ: 0.95,
    minStartSpeed: 0.2,
    minMaintainSpeed: 0.25,
    airWishSpeed: 0.3,
    airAccel: 0.035,
  },
  [PHANTOM_AERO_VEST_ITEM_ID]: {
    retentionXZ: 0.988,
    minStartSpeed: 0.2,
    minMaintainSpeed: 0.25,
    airWishSpeed: 0.3,
    airAccel: 0.035,
  },
};
