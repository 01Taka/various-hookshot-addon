import { Vector3Utils } from "@minecraft/math";
import { Player, system, Vector3 } from "@minecraft/server";
import { SPRING_WIRE_STYLE } from "../../render";
import {
  calculateSpringHookshot,
  SpringPhysicsConfig,
} from "../math/spring-math";
import {
  AirProbingCapable,
  AirProbingState,
  BaseHookshotDefinition,
  BaseHookshotState,
  ContinuousReelState,
  ReelCapable,
  RetractCapable,
  RetractState,
} from "../types";

export const SPRING_HOOKSHOT_ID = "spring";
export const SPRING_ITEM_ID = "various_hookshot_addon:spring_hookshot";

export interface SpringHookshotState
  extends BaseHookshotState<typeof SPRING_HOOKSHOT_ID>,
    AirProbingState,
    RetractState,
    ContinuousReelState {
  /** アンカーからプレイヤーへ向かう、フック着弾（刺さった）瞬間の初期方向ベクトル（単位ベクトル） */
  initialDirection?: Vector3;
  /** minRopeLength 未満で着弾した際、minRopeLength まで自動伸長中かどうか */
  isAutoExtendingToMin?: boolean;
  /** 手動伸長中の前Tickにおけるアンカーからの距離 (blocks) */
  lastExtendDistance?: number;
  /** 最後に縮め操作を行ったTick (縮め中の曲げ減衰ブースト用) */
  lastShortenTick?: number;
  /** 縮め中の曲げ減衰ブーストの現在ブレンド率 (0.0〜1.0) */
  shortenDampingBlend?: number;
}

export interface SpringAutoExtendToMinConfig {
  /** minRopeLength 未満で着弾した際に minRopeLength まで自動で伸ばす速度 (blocks/tick) */
  speed: number;
}

export interface SpringShortenCompressionBrakeConfig {
  /** 圧縮量（currentLength - distance）1ブロックあたりの短縮速度減衰係数 */
  brakePerBlock: number;
  /** 圧縮時の最低短縮速度倍率（0〜1） */
  minSpeedMultiplier: number;
}

export interface SpringShortenBendingDampingConfig {
  /** 縮めている間に適用する強い曲げ減衰率 (0〜1) */
  boostedDamping: number;
  /** ブーストの立ち上がりにかかる時間 (ticks) */
  rampUpTicks: number;
  /** ブーストの立ち下がり（元の値へ戻るまで）にかかる時間 (ticks) */
  rampDownTicks: number;
}

export interface SpringHookshotDefinition
  extends BaseHookshotDefinition<
      typeof SPRING_HOOKSHOT_ID,
      SpringHookshotState
    >,
    ReelCapable,
    AirProbingCapable,
    RetractCapable {
  /** 圧縮状態で手動伸長する際、外向き移動量に追従して距離差が縮まないように伸ばすか */
  matchOutwardExtend: boolean;
  /** minRopeLength 未満で着弾した際に minRopeLength まで自動で伸ばす設定 */
  autoExtendToMin: SpringAutoExtendToMinConfig;
  /** 圧縮状態（distance < currentLength）で短縮する際の速度ブレーキ設定 */
  shortenCompressionBrake: SpringShortenCompressionBrakeConfig;
  /** 縮め操作中および直後の曲げ減衰ブースト設定 */
  shortenBendingDamping: SpringShortenBendingDampingConfig;
  /** 曲げ復元力の基準モード ("shot_angle" | "surface_normal") */
  bendingMode: SpringBendingMode;
  /** バネの物理パラメータ */
  physics: SpringPhysicsConfig;
  /** ワイヤー描画時の基準軸（法線または曲げ軸）を解決するコールバック */
  getWireAxis: (state: SpringHookshotState) => Vector3 | undefined;
}

/**
 * バネの曲げ復元力（角度維持）の基準モード
 * - "shot_angle": 刺さった瞬間の角度・方向を維持（新仕様）
 * - "surface_normal": 着弾面の法線方向（垂直）を維持（従来の仕様）
 */
export type SpringBendingMode = "shot_angle" | "surface_normal";

/**
 * 現在の設定に応じた曲げ基準軸（角度維持ベクトル）を取得します
 */
export function getSpringBendingAxis(
  state: SpringHookshotState,
): Vector3 | undefined {
  return springHookshotDefinition.bendingMode === "shot_angle"
    ? (state.initialDirection ?? state.normal)
    : state.normal;
}

/**
 * スライムボール（minecraft:slime_ball）を使用した双方向バネフックショットの定義
 * 空中ジャンプ入力で短く（shorten）、シフト入力で長く（extend）
 */
export const springHookshotDefinition: SpringHookshotDefinition = {
  id: SPRING_HOOKSHOT_ID,
  itemTypeId: SPRING_ITEM_ID,
  maxDistance: 48,
  reel: {
    mode: "continuous",
    speed: {
      shorten: 1.0,
      extend: 0.5,
    },
    initialDelta: 0.0,
  },
  reelMode: "extend",
  minRopeLength: 5.0,
  baumgarteFactor: 0.15,
  matchOutwardExtend: true,
  autoExtendToMin: {
    speed: 2.0,
  },
  shortenCompressionBrake: {
    brakePerBlock: 0.2,
    minSpeedMultiplier: 0.25,
  },
  shortenBendingDamping: {
    boostedDamping: 0.25,
    rampUpTicks: 8,
    rampDownTicks: 16,
  },
  bendingMode: "shot_angle",
  physics: {
    minConstraintLength: 200,
    constraintLengthMultiplier: 1.5,
    stiffness: 0.9,
    damping: 0.01,
    maxAcceleration: 10,
    minRadialDenominator: 7.0,
    minBendingDenominator: 3.0,
    bendingStiffness: 1.8,
    bendingPower: 2,
    bendingDamping: 0.02,
    bendingReturnDampingMultiplier: 4.0,
    horizontalBendingMaxAccel: 0.24,
    surfacePenetrationMultiplier: 1.5,
  },
  shotSoundId: "mob.slime.jump",
  airProbing: {
    initialLength: 2.0,
    extend: {
      mode: "continuous",
      speed: 4.0,
      soundId: "step.slime",
      soundIntervalTicks: 2,
    },
    minHitDistance: 0.5,
    hitSoundId: "place.slime.big",
  },
  retract: {
    mode: "continuous",
    speed: 4.0,
    soundId: "step.slime",
    soundIntervalTicks: 2,
  },
  wireStyle: SPRING_WIRE_STYLE,
  getWireAxis: (state) => getSpringBendingAxis(state),
  calculateImpulse: (player, state) => {
    const bendingAxis = getSpringBendingAxis(state);
    const {
      minConstraintLength,
      constraintLengthMultiplier,
      ...springParams
    } = springHookshotDefinition.physics;

    const { boostedDamping, rampUpTicks, rampDownTicks } =
      springHookshotDefinition.shortenBendingDamping;
    const isShortening = state.lastShortenTick === system.currentTick;
    const prevBlend = state.shortenDampingBlend ?? 0;
    const nextBlend = isShortening
      ? Math.min(1, prevBlend + 1 / Math.max(1, rampUpTicks))
      : Math.max(0, prevBlend - 1 / Math.max(1, rampDownTicks));
    state.shortenDampingBlend = nextBlend;

    const effectiveBendingDamping =
      springParams.bendingDamping +
      (boostedDamping - springParams.bendingDamping) * nextBlend;

    return calculateSpringHookshot(player, state.anchor, {
      naturalLength: state.currentLength,
      maxLength: Math.max(
        minConstraintLength,
        state.currentLength * constraintLengthMultiplier,
      ),
      baumgarteFactor: springHookshotDefinition.baumgarteFactor ?? 0.15,
      surfaceNormal: state.normal,
      bendingAxis,
      ...springParams,
      bendingDamping: effectiveBendingDamping,
    });
  },
  onAttach: (_player, state, { initialDirection, distance }) => {
    state.initialDirection = initialDirection;
    const targetMinLength = Math.min(
      springHookshotDefinition.minRopeLength,
      springHookshotDefinition.maxDistance,
    );
    state.isAutoExtendingToMin = distance < targetMinLength;
  },
  onDetach: (_player, state) => {
    state.isAutoExtendingToMin = false;
    state.lastExtendDistance = undefined;
  },
  canHandleReelInput: (_player, state) => !state.isAutoExtendingToMin,
  modifyReelSpeed: (player, state, mode, baseSpeed, isInitial) => {
    const isAnchored = state.isAnchored !== false;
    if (!isAnchored) return baseSpeed;

    if (mode === "shorten") {
      const distance = Vector3Utils.distance(player.location, state.anchor);
      const compression = state.currentLength - distance;
      if (compression > 0) {
        const { brakePerBlock, minSpeedMultiplier } =
          springHookshotDefinition.shortenCompressionBrake;
        const multiplier = Math.max(
          minSpeedMultiplier,
          1 / (1 + Math.max(0, brakePerBlock) * compression),
        );
        return baseSpeed * multiplier;
      }
    } else if (
      mode === "extend" &&
      springHookshotDefinition.matchOutwardExtend
    ) {
      const distance = Vector3Utils.distance(player.location, state.anchor);
      const prevDistance = state.lastExtendDistance;
      state.lastExtendDistance = distance;
      if (
        !isInitial &&
        prevDistance !== undefined &&
        distance < state.currentLength
      ) {
        const outwardDelta = Math.max(0, distance - prevDistance);
        return Math.max(baseSpeed, outwardDelta);
      }
    }
    return baseSpeed;
  },
  onLengthChanged: (_player, state, mode) => {
    if (mode === "shorten") {
      state.lastShortenTick = system.currentTick;
    }
  },
  onTick: (player, state, { activeReelMode }, ctx) => {
    if (state.isAnchored === false) return;

    let dirty = false;
    if (state.lastExtendDistance !== undefined) {
      if (activeReelMode !== "extend") {
        state.lastExtendDistance = undefined;
      }
      dirty = true;
    }

    if (state.isAutoExtendingToMin) {
      const targetMinLength = Math.min(
        springHookshotDefinition.minRopeLength,
        springHookshotDefinition.maxDistance,
      );
      if (state.currentLength >= targetMinLength) {
        state.isAutoExtendingToMin = false;
      } else {
        const stepPerTick = Math.max(
          0,
          springHookshotDefinition.autoExtendToMin.speed,
        );
        const nextLength = Math.min(
          state.currentLength + stepPerTick,
          targetMinLength,
        );
        state.currentLength = nextLength;
        if (nextLength >= targetMinLength) {
          state.isAutoExtendingToMin = false;
        }
      }
      dirty = true;
    }

    if (dirty) {
      ctx.setActiveState(player, state);
    }
  },
};
