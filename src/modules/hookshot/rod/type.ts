import {
  AirProbingCapable,
  AirProbingState,
  BaseHookshotDefinition,
  BaseHookshotState,
  ReelCapable,
  RetractCapable,
  RetractState,
  StepReelState,
} from "../types";

export const ROD_HOOKSHOT_ID = "rod";

export interface RodHookshotState
  extends BaseHookshotState<typeof ROD_HOOKSHOT_ID>,
    AirProbingState,
    RetractState,
    StepReelState {}

export interface RodHookshotDefinition
  extends BaseHookshotDefinition<typeof ROD_HOOKSHOT_ID, RodHookshotState>,
    ReelCapable,
    AirProbingCapable,
    RetractCapable {}
