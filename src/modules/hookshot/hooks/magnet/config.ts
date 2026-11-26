import { MAGNET_GUIDE_WIRE_STYLE } from "../../../render";
import { MAGNET_HOOKSHOT_ID, MagnetHookshotDefinition } from "./type";

export const MAGNET_ITEM_ID = "various_hookshot_addon:magnet_hookshot";

export const MAGNET_STICK_RAY_EXTRA_DISTANCE = 0.25;
export const MAGNET_HEAD_STICK_RADIUS = 1.0;
export const MAGNET_STICK_RESTORE_GAIN = 0.5;
export const MAGNET_CHARGE_PARTICLE_ID = "various_hookshot_addon:magnet_charge";
export const MAGNET_CHARGE_INTERVAL_TICKS = 4;
export const MAGNET_STICK_SOUND_ID = "random.click";

export const magnetHookshotConfig: Omit<
  MagnetHookshotDefinition,
  "calculateImpulse"
> = {
  id: MAGNET_HOOKSHOT_ID,
  itemTypeId: MAGNET_ITEM_ID,
  maxDistance: 100,
  consumeDurabilityOnDetach: false,
  wireStyle: MAGNET_GUIDE_WIRE_STYLE,
  shotSoundId: "crossbow.shoot",
  hitSoundId: "block.lodestone.place",
  missSoundId: "note.bass",
  detachSoundId: "beacon.deactivate",
  activeSound: {
    soundId: "beacon.ambient",
    intervalTicks: 10,
  },
  physics: {
    fullEffectDistance: 50,
    zeroEffectDistance: 80,
    attractInitialSpeed: 1.6,
    attractAccel: 0.2,
    attractMaxSpeed: 3.0,
    attractNearRadius: 2.0,
    attractNearScale: 1 / 3,
    attractStickRadius: 1.6,
    attractGravityCancelStart: 0.35,
    attractGravityCancelRampTicks: 20,
    repelBurstSpeed: 2.2,
    repelSustainAccel: 0.2,
    repelRefDistance: 10.0,
    repelBurstCooldownTicks: 10,
    repelSustainDelayTicks: 5,
    repelSlowFallMinImpulseY: 0.4,
  },
};
