import { Vector3Utils } from "@minecraft/math";
import { RIGID_WIRE_STYLE } from "../../render";
import { calculateRigidHookshot, RigidPhysicsConfig } from "../math/rigid-math";
import {
  calculateReelSpeedMultiplier,
  canUseGazeSteering,
  RigidSteeringConfig,
} from "../math/steering-math";
import {
  BaseHookshotDefinition,
  BaseHookshotState,
  ContinuousReelState,
  GazeSteeringCapable,
  RaycastGraceCapable,
  ReelCapable,
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
  /** アンカーより上に滞在して蓄積した減衰Tick数（アンカーより下で待機後に徐々に回復） */
  aboveAnchorTicks?: number;
  /** アンカーより下に連続滞在しているTick数（回復待機カウント用） */
  belowAnchorTicks?: number;
}

export interface RigidHookshotDefinition
  extends BaseHookshotDefinition<typeof RIGID_HOOKSHOT_ID, RigidHookshotState>,
    ReelCapable,
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
    maxSteeringSpeed: 2.2,
    maxSteeringSpeedNormal: 1.7,
    reelGravityScaleVest: 0.8,
    swingPumpAccelNormal: 0.015,
    swingPumpAccelVest: 0.04,
  },
  steering: {
    steerAccel: 0.065,
    steerAccelNormal: 0.05,
    referenceSwingDistance: 30,
    fullSteerAngleDeg: 45,
    steerFadeStartDeg: 90,
    steerFadeEndDeg: 110,
    adPriorityAngleDeg: 30,
    centrifugal3DReferenceAccel: 0.12,
    centrifugal3DDownwardScale: 0.25,
    maxUpwardTiltDeg: 45,
    tiltFullElevationDeg: 30,
    tiltHalfDistance: 30,
    tiltFullDistance: 20,
    tiltRatePerTick: 0.25,
    aboveAnchorDecayTicks: 20,
    belowAnchorRecoveryDelayTicks: 4,
    belowAnchorRecoveryRate: 1,
    centrifugalReferenceAccel: 0.28,
    reelCentrifugalHorizWeight: 1.0,
    reelCentrifugalVertWeight: 0.3,
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
      enableSteering: true,
      hasAeroVest: hasVest,
      aboveAnchorTicks: state.aboveAnchorTicks,
      baumgarteFactor: baumgarteFactor ?? 0.15,
      physics,
      steering,
      swingPumpAccel: hasVest
        ? physics.swingPumpAccelVest
        : physics.swingPumpAccelNormal,
    });
  },
  onAttach: (_player, state) => {
    state.autoTakeUpRemainingTicks =
      rigidHookshotDefinition.autoTakeUp.ticks > 0
        ? rigidHookshotDefinition.autoTakeUp.ticks
        : 0;
  },
  isReelBlocked: (player, state, mode, ctx) => {
    if (mode !== "shorten") return false;
    const { maxSpeed, ticks, restoreDiff } =
      rigidHookshotDefinition.stallReelStop;
    const distance = Vector3Utils.distance(player.location, state.anchor);
    const diff = distance - state.currentLength;
    const speed = Vector3Utils.magnitude(player.getVelocity());
    const prevTicks = state.stallReelTicks ?? 0;

    if (speed <= maxSpeed && diff >= restoreDiff - 0.01) {
      if (prevTicks >= ticks) {
        if (diff > restoreDiff) {
          state.currentLength = Math.min(
            rigidHookshotDefinition.maxDistance,
            distance - restoreDiff,
          );
          ctx.setActiveState(player, state);
        }
        return true;
      }
      if (diff > restoreDiff) {
        const nextTicks = prevTicks + 1;
        state.stallReelTicks = nextTicks;
        if (nextTicks >= ticks) {
          state.currentLength = Math.min(
            rigidHookshotDefinition.maxDistance,
            distance - restoreDiff,
          );
          ctx.setActiveState(player, state);
          return true;
        }
        ctx.setActiveState(player, state);
        return false;
      }
    }

    if (prevTicks !== 0) {
      state.stallReelTicks = 0;
      ctx.setActiveState(player, state);
    }
    return false;
  },
  modifyReelSpeed: (player, state, mode, baseSpeed) => {
    if (mode === "shorten" && rigidHookshotDefinition.enableGazeSteering) {
      const multiplier = calculateReelSpeedMultiplier(
        player,
        state.anchor,
        state.currentLength,
        rigidHookshotDefinition.steering,
      );
      return baseSpeed * multiplier;
    }
    return baseSpeed;
  },
  onLengthChanged: (player, state, mode, _prevLength, nextLength) => {
    const outward = rigidHookshotDefinition.reelLengthDiffLimit?.outward;
    if (mode === "shorten" && outward !== undefined && state.isReelingIn) {
      const distance = Vector3Utils.distance(player.location, state.anchor);
      const minAllowedByDiff = distance - outward;
      if (nextLength <= minAllowedByDiff) {
        state.isReelingIn = false;
      }
    }
  },
  onTick: (player, state, { activeReelMode }, ctx) => {
    let dirty = false;

    if (activeReelMode !== "shorten" && state.stallReelTicks) {
      state.stallReelTicks = 0;
      dirty = true;
    }

    const maxAboveTicks = rigidHookshotDefinition.steering.aboveAnchorDecayTicks;
    const currentAboveTicks = state.aboveAnchorTicks ?? 0;
    const currentBelowTicks = state.belowAnchorTicks ?? 0;

    if (player.location.y >= state.anchor.y) {
      if (currentBelowTicks !== 0) {
        state.belowAnchorTicks = 0;
        dirty = true;
      }
      if (currentAboveTicks < maxAboveTicks) {
        state.aboveAnchorTicks = currentAboveTicks + 1;
        dirty = true;
      }
    } else if (currentAboveTicks > 0) {
      const nextBelowTicks = currentBelowTicks + 1;
      if (nextBelowTicks !== currentBelowTicks) {
        state.belowAnchorTicks = nextBelowTicks;
        dirty = true;
      }
      const recoveryDelayTicks =
        rigidHookshotDefinition.steering.belowAnchorRecoveryDelayTicks ?? 4;
      const recoveryRate =
        rigidHookshotDefinition.steering.belowAnchorRecoveryRate ?? 1;
      if (nextBelowTicks >= recoveryDelayTicks) {
        const nextAboveTicks = Math.max(0, currentAboveTicks - recoveryRate);
        if (nextAboveTicks !== currentAboveTicks) {
          state.aboveAnchorTicks = nextAboveTicks;
          if (nextAboveTicks === 0) {
            state.belowAnchorTicks = 0;
          }
          dirty = true;
        }
      }
    } else if (currentBelowTicks !== 0) {
      state.belowAnchorTicks = 0;
      dirty = true;
    }

    const remaining = state.autoTakeUpRemainingTicks ?? 0;
    if (remaining > 0) {
      if (activeReelMode !== null) {
        state.autoTakeUpRemainingTicks = 0;
        dirty = true;
      } else {
        const distance = Vector3Utils.distance(player.location, state.anchor);
        const minLength = rigidHookshotDefinition.minRopeLength;
        if (distance < state.currentLength) {
          state.currentLength = Math.max(
            minLength,
            distance,
            state.currentLength - rigidHookshotDefinition.autoTakeUp.speed,
          );
        }
        state.autoTakeUpRemainingTicks =
          state.currentLength <= minLength ? 0 : remaining - 1;
        dirty = true;
      }
    }

    if (dirty) {
      ctx.setActiveState(player, state);
    }
  },
};
