import { RIGID_WIRE_STYLE } from "../../render";
import { calculateRigidHookshot, RigidPhysicsConfig } from "../math/rigid-math";
import { canUseGazeSteering, RigidSteeringConfig } from "../math/steering-math";
import {
  BaseHookshotDefinition,
  BaseHookshotState,
  ContinuousReelState,
  GazeSteeringCapable,
  RaycastGraceCapable,
} from "../types";

export const RIGID_HOOKSHOT_ID = "rigid";
export const RIGID_ITEM_ID = "various_hookshot_addon:rigid_hookshot";

export interface RigidHookshotState
  extends BaseHookshotState<typeof RIGID_HOOKSHOT_ID>,
    ContinuousReelState {
  /** 着弾直後の自動巻き取り残りTick数 */
  autoTakeUpRemainingTicks?: number;
  /** 巻き取り中に速度低下で停止している連続Tick数 */
  stallReelTicks?: number;
}

export interface RigidHookshotDefinition
  extends BaseHookshotDefinition<typeof RIGID_HOOKSHOT_ID, RigidHookshotState>,
    RaycastGraceCapable,
    GazeSteeringCapable {
  /** 着弾直後にワイヤーが短い間だけ行う高速自動巻き取り設定 */
  autoTakeUp: {
    /** 自動巻き取りを行う最大Tick数 */
    ticks: number;
    /** 1Tickあたりの最大短縮速度 (blocks/tick) */
    speed: number;
  };
  /** 巻き取り中にプレイヤーがほとんど停止した場合の戻し・停止設定 */
  stallReelStop: {
    /** 停止とみなす速度閾値 (blocks/tick) */
    maxSpeed: number;
    /** 停止判定が成立する連続Tick数 */
    ticks: number;
    /** 停止時にチェーン長を戻す基準の距離差 (blocks) */
    restoreDiff: number;
  };
  /** 剛体ロープの物理パラメータ */
  physics: RigidPhysicsConfig;
  /** 視線ステアリング・振り子スイングパラメータ */
  steering: RigidSteeringConfig;
}

/**
 * 糸（minecraft:string）を使用した伸びがない（剛体ロープ）フックショットの定義
 * 空中ジャンプ入力で短く（shorten）、シフト入力で長く（extend）
 * 空中ジャンプ短縮＋横向き視線でパスファインダー型スリングショット旋回軌道に対応
 */
export const rigidHookshotDefinition: RigidHookshotDefinition = {
  id: RIGID_HOOKSHOT_ID,
  itemTypeId: RIGID_ITEM_ID,
  maxDistance: 200,
  reel: {
    mode: "continuous",
    speed: 2.0,
    initialDelta: 0.0,
    soundId: "step.chain",
    soundIntervalTicks: 4,
  },
  reelMode: "shorten",
  minRopeLength: 1.5,
  baumgarteFactor: 0.18,
  reelLengthDiffLimit: {
    outward: 10.0,
  },
  stallReelStop: {
    maxSpeed: 0.1,
    ticks: 4,
    restoreDiff: 4.0,
  },
  raycastGraceTicks: 10,
  shotSoundId: "crossbow.shoot",
  hitSoundId: "place.chain",
  missSoundId: "dig.chain",
  wireStyle: RIGID_WIRE_STYLE,
  enableGazeSteering: true,
  autoTakeUp: {
    ticks: 15,
    speed: 5.0,
  },
  physics: {
    tautMargin: 0.25,
    innerSwingMargin: 2.0,
    innerBaumgarteFactor: 0.08,
    inwardEscapeThreshold: 0.45,
    maxSteeringSpeed: 1.65,
    swingPumpAccelNormal: 0.015,
    swingPumpAccelVest: 0.04,
  },
  steering: {
    steerAccel: 0.12,
    referenceSwingDistance: 30,
    maxUpwardBankDeg: 30,
    bankFullElevationDeg: 25,
    fullSteerAngleDeg: 45,
    steerFadeStartDeg: 90,
    steerFadeEndDeg: 110,
    adPriorityAngleDeg: 30,
    minGravityRatio: 0.25,
    planeDownwardDamping: 0.18,
    centrifugalReferenceAccel: 0.1,
    centrifugalMinRadius: 8.0,
    minReelSpeedMultiplier: 0.25,
    slackDeadzone: 0.5,
    pumpLowSpeedStart: 0.05,
    pumpLowSpeedEnd: 0.25,
  },
  calculateImpulse: (player, state) => {
    const hasVest = canUseGazeSteering(player);
    const { physics, steering, baumgarteFactor } = rigidHookshotDefinition;
    return calculateRigidHookshot(player, state.anchor, state.currentLength, {
      isReelingIn: state.isReelingIn,
      enableSteering: hasVest,
      baumgarteFactor: baumgarteFactor ?? 0.15,
      physics,
      steering,
      swingPumpAccel: hasVest
        ? physics.swingPumpAccelVest
        : physics.swingPumpAccelNormal,
    });
  },
};
