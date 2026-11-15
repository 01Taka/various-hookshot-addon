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
  /** 張った状態での連続巻き取り継続Tick数（立ち上がりランプアップ用） */
  tautReelTicks?: number;
  /** 直近Tickで張った状態から実際に短縮した長さ (blocks/tick) */
  lastTautReelSpeed?: number;
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
  /** 張った状態での巻き取り開始時の立ち上がり設定 */
  reelRampUp: {
    /** 開始時の速度倍率 (0〜1) */
    initialRatio: number;
    /** 最高速度（100%）に到達するまでのTick数 */
    durationTicks: number;
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
    speed: 0.8,
    slackSpeed: 4.0,
    initialDelta: 0.0,
    soundId: "step.chain",
    soundIntervalTicks: 4,
  },
  reelRampUp: {
    initialRatio: 0.35,
    durationTicks: 4,
  },
  reelMode: "shorten",
  minRopeLength: 1.5,
  reelLengthDiffLimit: {
    outward: 4.0,
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
    steerAccel: 0.085,
    maxRotationPowerRatio: 0.6,
    referenceSwingDistance: 30,
    slackDeadzone: 0.5,
    pumpLowSpeedStart: 0.05,
    pumpLowSpeedEnd: 0.25,
  },
  calculateImpulse: (player, state) => {
    const hasVest = canUseGazeSteering(player);
    const { physics, steering } = rigidHookshotDefinition;
    return calculateRigidHookshot(player, state.anchor, state.currentLength, {
      isReelingIn: state.isReelingIn,
      reelingSpeed: state.lastTautReelSpeed ?? 0,
      enableSteering: hasVest,
      physics,
      steering,
      swingPumpAccel: hasVest
        ? physics.swingPumpAccelVest
        : physics.swingPumpAccelNormal,
    });
  },
};
