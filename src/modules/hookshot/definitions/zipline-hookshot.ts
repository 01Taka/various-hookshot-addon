import { Vector3Utils } from "@minecraft/math";
import { Vector3 } from "@minecraft/server";
import { isInputButtonPressed, isSneakButtonPressed } from "addon-utils";
import { ZIPLINE_WIRE_STYLE } from "../../render";
import { RigidPhysicsConfig } from "../math/rigid-math";
import { canUseGazeSteering, RigidSteeringConfig } from "../math/steering-math";
import {
  calculateZiplineHookshot,
  ZiplineRailPhysicsConfig,
} from "../math/zipline-math";
import { BaseHookshotDefinition, BaseHookshotState } from "../types";

export const ZIPLINE_HOOKSHOT_ID = "zipline";
export const ZIPLINE_ITEM_ID = "various_hookshot_addon:zipline_hookshot";

export interface ZiplineHookshotState
  extends BaseHookshotState<typeof ZIPLINE_HOOKSHOT_ID> {
  /** 支柱の地面側ベース座標 */
  railBase: Vector3;
  /** 終点側支柱の地面側／壁面側ベース座標 */
  endRailBase?: Vector3;
  /** 終点側支柱の先端座標（省略時は railEnd を使用） */
  endRailTop?: Vector3;
  /** レールの始点（支柱頂点）座標 */
  railStart: Vector3;
  /** レールの終点（着弾オフセット後または終点支柱頂点）座標 */
  railEnd: Vector3;
  /** 始点側を支えているブロック座標 */
  startSupportBlock: Vector3;
  /** 終点側を支えているブロック座標 */
  endSupportBlock: Vector3;
  /** レールの全長 (blocks) */
  railLength: number;
  /** 始点からの現在進行距離 (0 〜 railLength, blocks) */
  railProgress: number;
  /** レール上の現在速度 (blocks/tick, 正=終点方向, 負=始点方向) */
  railVelocity: number;
  /** 視線に基づく現在の正面進行符号 (+1: 終点方向, -1: 始点方向) */
  facingDirectionSign?: 1 | -1;
  /** 滑走効果音の直近再生Tick */
  lastSlideSoundTick?: number;
  /** 緩やか降下条件を連続で満たしているTick数 */
  gentleDescentTicks?: number;
  /** 直近で1tick低速落下を付与したTick */
  lastSlowFallTick?: number;
}

export interface ZiplineHookshotDefinition
  extends BaseHookshotDefinition<
    typeof ZIPLINE_HOOKSHOT_ID,
    ZiplineHookshotState
  > {
  /** 足元4点レイキャストによる発射判定・支柱設定 */
  groundCheck: {
    /** 足元中心からのXZオフセット幅 (blocks) */
    halfWidth: number;
    /** 下向きレイキャストの最大距離 (blocks) */
    maxDownDistance: number;
    /** 支柱の高さ (blocks) */
    pillarHeight: number;
    /** 天井ブロックとの最小クリアランス (blocks) */
    ceilingClearance: number;
    /** 着弾面の法線方向への手前オフセット量 (blocks) */
    endNormalOffset: number;
    /** 生成可能な最小レール長 (blocks) */
    minRailLength: number;
  };
  /** 吊り下げ鎖の基準長（足元基準, blocks） */
  hangingRopeLength: number;
  /** 無入力（Jump/Shift未押下）時に鎖へ加えるたるみ余裕 (blocks) */
  idleSlackOffset: number;
  /** 入力（Jump/Shift押下）時に鎖を詰める短縮量 (blocks) */
  activePullOffset: number;
  /** 描画上の鎖長（胴基準, blocks） */
  visualChainLength: number;
  /** 着弾・解除・不発・滑走音設定 */
  hitSoundId: string;
  missSoundId: string;
  detachSoundId: string;
  slideSound: {
    soundId: string;
    intervalTicks: number;
    minSpeed: number;
  };
  /** 緩やかな降下時の累積落下ダメージ防止設定 */
  fallProtection: {
    /** 許容するアンカーY速度の下限 (blocks/tick) */
    minAnchorVelY: number;
    /** 許容するプレイヤーY速度の下限 (blocks/tick) */
    minPlayerVelY: number;
    /** 鎖が張っているとみなす距離マージン (blocks) */
    tautMargin: number;
    /** 付与に必要な連続条件達成Tick数 */
    requiredConsecutiveTicks: number;
    /** 低速落下再付与までのクールタイム (ticks) */
    cooldownTicks: number;
  };
  /** レール上の1次元アンカー移動物理パラメータ */
  railPhysics: ZiplineRailPhysicsConfig;
  /** 吊り下げ剛体ロープの物理パラメータ */
  physics: RigidPhysicsConfig;
  /** 振り子ポンプ用の最小ステアリングパラメータ */
  steering: RigidSteeringConfig;
}

export const ziplineHookshotDefinition: ZiplineHookshotDefinition = {
  id: ZIPLINE_HOOKSHOT_ID,
  itemTypeId: ZIPLINE_ITEM_ID,
  maxDistance: 300,
  reel: {
    mode: "continuous",
    speed: 0,
  },
  reelMode: "shorten",
  minRopeLength: 4.7,
  hangingRopeLength: 5.0,
  idleSlackOffset: 0.3,
  activePullOffset: 0.3,
  visualChainLength: 4.0,
  baumgarteFactor: 0.42,
  groundCheck: {
    halfWidth: 0.5,
    maxDownDistance: 5.0,
    pillarHeight: 5.0,
    ceilingClearance: 0.3,
    endNormalOffset: 1.0,
    minRailLength: 3.0,
  },
  shotSoundId: "crossbow.shoot",
  hitSoundId: "place.chain",
  missSoundId: "dig.chain",
  detachSoundId: "dig.chain",
  slideSound: {
    soundId: "step.chain",
    intervalTicks: 4,
    minSpeed: 0.15,
  },
  fallProtection: {
    minAnchorVelY: -0.4,
    minPlayerVelY: -0.45,
    tautMargin: 0.5,
    requiredConsecutiveTicks: 5,
    cooldownTicks: 10,
  },
  wireStyle: ZIPLINE_WIRE_STYLE,
  railPhysics: {
    inputAccel: 0.104,
    railGravity: 0.092,
    friction: 0.06,
    brakeFriction: 0.2,
    maxRailSpeed: 2.2,
    maxAnchorDistance: 6.0,
    tautChainLength: 3.9,
    torsoHeightOffset: 1.0,
    stopSpeedThreshold: 0.005,
  },
  physics: {
    tautMargin: 0.25,
    innerSwingMargin: 2.0,
    innerBaumgarteFactor: 0.08,
    inwardEscapeThreshold: 0.45,
    maxSteeringSpeed: 2.2,
    swingPumpAccelNormal: 0.015,
    swingPumpAccelVest: 0.04,
  },
  steering: {
    steerAccel: 0.065,
    referenceSwingDistance: 30,
    fullSteerAngleDeg: 45,
    steerFadeStartDeg: 90,
    steerFadeEndDeg: 110,
    adPriorityAngleDeg: 30,
    centrifugal3DReferenceAccel: 0.14,
    maxUpwardTiltDeg: 45,
    tiltFullElevationDeg: 30,
    tiltHalfDistance: 20,
    tiltFullDistance: 12,
    tiltRatePerTick: 0.25,
    aboveAnchorDecayTicks: 20,
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
    const { physics, steering, baumgarteFactor } = ziplineHookshotDefinition;
    const railDir =
      state.railLength > 0.0001
        ? Vector3Utils.scale(
            Vector3Utils.subtract(state.railEnd, state.railStart),
            1 / state.railLength,
          )
        : { x: 0, y: 0, z: 1 };
    const anchorVelocity =
      state.railVelocity !== 0
        ? Vector3Utils.scale(railDir, state.railVelocity)
        : { x: 0, y: 0, z: 0 };

    let isPropelling = false;
    try {
      isPropelling =
        isInputButtonPressed(player, "Jump") ||
        player.isJumping ||
        isSneakButtonPressed(player);
    } catch {
      isPropelling = false;
    }

    return calculateZiplineHookshot(player, state.anchor, state.currentLength, {
      baumgarteFactor: baumgarteFactor ?? 0.42,
      physics,
      steering,
      swingPumpAccel: hasVest
        ? physics.swingPumpAccelVest
        : physics.swingPumpAccelNormal,
      railDir,
      anchorVelocity,
      parallelDamping: 0.14,
      lateralDamping: 0.02,
      suppressParallelSwing: isPropelling,
    });
  },
};
