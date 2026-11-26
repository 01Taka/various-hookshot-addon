import { ROD_WIRE_STYLE } from "../../../render";
import { ROD_HOOKSHOT_ID, RodHookshotDefinition } from "./type";

export const ROD_ITEM_ID = "various_hookshot_addon:rod_hookshot";

export const rodHookshotConfig: Omit<RodHookshotDefinition, "calculateImpulse"> =
  {
    id: ROD_HOOKSHOT_ID,
    itemTypeId: ROD_ITEM_ID,
    maxDistance: 42,
    reel: {
      mode: "step",
      stepLength: 2.0,
      initialIntervalTicks: 7,
      minIntervalTicks: 2,
      intervalDecayTicks: 1,
      soundId: "place.wood",
    },
    reelMode: "extend",
    minRopeLength: 2.0,
    baumgarteFactor: 0.15,
    reelLengthDiffLimit: {
      outward: 4.0,
      inward: 4.0,
    },
    shotSoundId: "step.wood",
    airProbing: {
      initialLength: 2.0,
      extend: {
        mode: "step",
        stepLength: 4.0,
        intervalTicks: 1,
        soundId: "place.wood",
      },
      minHitDistance: 1.5,
      hitSoundId: "place.wood",
    },
    retract: {
      mode: "step",
      stepLength: 2.0,
      intervalTicks: 1,
      soundId: "place.wood",
    },
    wireStyle: ROD_WIRE_STYLE,
  };
