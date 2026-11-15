import { Player, system, world } from "@minecraft/server";
import { PlayerStateManager } from "addon-utils";
import { ELASTIC_WIRE_STYLE } from "../../render";
import {
  calculateElasticHookshot,
  ElasticPhysicsConfig,
  ElasticReleaseConfig,
} from "../math/elastic-math";
import { canUseGazeSteering } from "../math/steering-math";
import {
  BaseHookshotDefinition,
  BaseHookshotState,
  ChargeMilestoneSoundConfig,
  ContinuousReelState,
  RaycastGraceCapable,
} from "../types";

export const ELASTIC_HOOKSHOT_ID = "elastic";
export const ELASTIC_ITEM_ID = "various_hookshot_addon:elastic_hookshot";
export const ELASTIC_AIR_CHAIN_KEY = "elasticAirChainState";

/**
 * 伸縮ロープフックの空中連続発動（発射後〜着地まで）追跡状態
 */
export interface ElasticAirChainState {
  /** 射出後に一度でも空中（非接地）に出たかどうか */
  hasBeenAirborne: boolean;
  /** 射出された Tick */
  launchTick: number;
}

let isElasticTrackingInitialized = false;

/**
 * 伸縮ロープフックの空中連続発動状態追跡（着地監視ループ）を初期化します。
 */
export function initElasticHookshotTracking(): void {
  if (isElasticTrackingInitialized) return;
  isElasticTrackingInitialized = true;

  system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
      if (!player.isValid) continue;

      const chain = PlayerStateManager.get<ElasticAirChainState | null>(
        player.id,
        ELASTIC_AIR_CHAIN_KEY,
        null,
      );
      if (!chain) continue;

      const isGrounded =
        player.isOnGround || player.isInWater || player.isClimbing;

      if (!isGrounded) {
        if (!chain.hasBeenAirborne) {
          chain.hasBeenAirborne = true;
          PlayerStateManager.set(player.id, ELASTIC_AIR_CHAIN_KEY, chain);
        }
      } else if (chain.hasBeenAirborne || system.currentTick - chain.launchTick >= 10) {
        PlayerStateManager.delete(player.id, ELASTIC_AIR_CHAIN_KEY);
      }
    }
  }, 1);
}

// モジュールロード時に自動で初期化
initElasticHookshotTracking();

/**
 * 伸縮ロープフックによるパチンコ射出をマークし、着地までチャージ速度バフを有効化します。
 */
export function markElasticAirLaunch(player: Player): void {
  const isGrounded =
    player.isOnGround || player.isInWater || player.isClimbing;
  PlayerStateManager.set<ElasticAirChainState>(player.id, ELASTIC_AIR_CHAIN_KEY, {
    hasBeenAirborne: !isGrounded,
    launchTick: system.currentTick,
  });
}

/**
 * プレイヤーが現在、射出後〜着地までの空中チャージ速度バフ状態にあるかを返します。
 */
export function isElasticAirChainActive(player: Player): boolean {
  return (
    PlayerStateManager.get<ElasticAirChainState | null>(
      player.id,
      ELASTIC_AIR_CHAIN_KEY,
      null,
    ) !== null
  );
}

export interface ElasticHookshotState
  extends BaseHookshotState<typeof ELASTIC_HOOKSHOT_ID>,
    ContinuousReelState {
  /** 最小ロープ長到達後に蓄積された追加チャージ量 (blocks) */
  extraCharge?: number;
  /** チャージ解放による放物線射出モード中かどうか */
  isChargeReleasing?: boolean;
  /** リリース直後の初速インパルスを未適用かどうか */
  releaseShotPending?: boolean;
  /** リリース開始Tick */
  releaseStartTick?: number;
  /** 放物線射出中の前Tickにおけるアンカーとの距離 */
  lastReleaseDistance?: number;
  /** 放物線射出中に接近速度が閾値を下回った連続Tick数 */
  releaseStallTicks?: number;
  /** 前Tickのチャージ伸び量（マイルストーン効果音判定用） */
  prevChargeStretch?: number;
  /** 直近に鳴らしたチャージマイルストーン距離 (m) */
  lastChargeSoundThreshold?: number;
  /** 直近のマイルストーンから±hysteresis以上離れて再鳴動可能になったか */
  canRetriggerLastThreshold?: boolean;
}

export interface ElasticDistanceReelSpeedConfig {
  /** 加速が開始されるアンカー距離の下限 (blocks) */
  minDistance: number;
  /** 最大巻き取り速度に到達するアンカー距離の上限 (blocks) */
  maxDistance: number;
  /** 遠距離到達時の最大巻き取り速度 (blocks/tick) */
  maxSpeed: number;
}

export interface ElasticChargeSpeedBoostConfig {
  /** 空中チェイン時の近距離側（minDistance以下）の巻き取り速度 (blocks/tick) */
  airChainMinSpeed: number;
  /** 空中チェイン時の遠距離側（maxDistance以上）の巻き取り速度 (blocks/tick) */
  airChainMaxSpeed: number;
}

export interface ElasticHookshotDefinition
  extends BaseHookshotDefinition<
      typeof ELASTIC_HOOKSHOT_ID,
      ElasticHookshotState
    >,
    RaycastGraceCapable {
  /** 最小ロープ長到達後に追加で蓄積できる仮想チャージ上限 (blocks, 未指定時は無制限) */
  maxExtraCharge?: number;
  /** 自然長との差（stretch）がこの距離 (blocks) を超えるとゴムが切れて自動解除される */
  maxOverstretchDistance: number;
  /** 伸び切り破断時の効果音ID */
  overstretchSoundId: string;
  /** アンカーとの距離に応じた巻き取り速度ブースト設定 */
  distanceReelSpeed: ElasticDistanceReelSpeedConfig;
  /** 空中チェイン・エアロベスト後ろ入力によるチャージ速度バフ設定 */
  chargeSpeedBoost: ElasticChargeSpeedBoostConfig;
  /** 伸縮ゴム紐の弾性・チャージ物理パラメータ */
  physics: ElasticPhysicsConfig;
  /** チャージ解放（パチンコ射出）パラメータ */
  release: ElasticReleaseConfig;
  /** チャージ中の伸び量マイルストーン効果音設定 */
  chargeMilestoneSound: ChargeMilestoneSoundConfig;
  /** 接続中アクションバーの表示文字列をカスタマイズするコールバック */
  formatDistanceUi: (
    player: Player,
    state: ElasticHookshotState,
    distance: number,
  ) => string;
}

/**
 * リード（minecraft:lead）を使用した伸縮性（ゴム紐）フックショットの定義
 * 空中ジャンプ入力でゴムを巻き取り張力（stretch）をチャージし、
 * 離した瞬間に溜まったエネルギーを一気に解放してパチンコのように射出します。
 * エアロベスト装備時は前後入力（W/S）でチャージと巻き取り移動の配分を調整できます。
 */
export const elasticHookshotDefinition: ElasticHookshotDefinition = {
  id: ELASTIC_HOOKSHOT_ID,
  itemTypeId: ELASTIC_ITEM_ID,
  maxDistance: 250,
  reel: {
    mode: "continuous",
    speed: 1.8,
    slackSpeed: 4.5,
    initialDelta: 0.0,
    soundId: "step.cloth",
    soundIntervalTicks: 4,
  },
  reelMode: "shorten",
  minRopeLength: 1.5,
  maxOverstretchDistance: 105.0,
  overstretchSoundId: "various_hookshot_addon.elastic_break",
  distanceReelSpeed: {
    minDistance: 20.0,
    maxDistance: 120.0,
    maxSpeed: 4.0,
  },
  chargeSpeedBoost: {
    airChainMinSpeed: 4.5,
    airChainMaxSpeed: 5.2,
  },
  raycastGraceTicks: 10,
  shotSoundId: "armor.equip_leather",
  hitSoundId: "leashknot.place",
  missSoundId: "leashknot.break",
  physics: {
    minConstraintLength: 250,
    constraintLengthMultiplier: 1.5,
    hangElasticity: 0.65,
    minHangDenominator: 18.0,
    maxHangDenominator: 120.0,
    chargeStiffness: 0.003,
    damping: 0.001,
    chargeDamping: 0.085,
    maxAcceleration: 1.35,
    inputChargeControl: {
      enabled: true,
      forwardGainNormal: 0.5,
      forwardGainBoosted: 1.2,
      backwardMinMultiplierNormal: 0.65,
      backwardMinMultiplierBoosted: 0.3,
    },
  },
  release: {
    soundId: "random.bow",
    minStretch: 5.0,
    referenceStretch: 90.0,
    minLaunchSpeed: 1.45,
    maxLaunchSpeed: 4.0,
    launchSpeedExponent: 1.6,
    boostedStretchMultiplier: 1.3,
    upwardBias: 0.22,
    minFlightTicks: 4,
    stallApproachSpeed: 0.4,
    maxStallTicks: 5,
    maxReleaseTicks: 60,
  },
  chargeMilestoneSound: {
    soundId: "note.guitar",
    step: 15,
    maxStretch: 90,
    hysteresis: 5,
    pitches: [0.65, 0.85, 1.1, 1.35, 1.65, 1.95],
  },
  wireStyle: ELASTIC_WIRE_STYLE,
  formatDistanceUi: (_player, state, distance) => {
    const stretch =
      Math.max(0, distance - state.currentLength) + (state.extraCharge ?? 0);
    const prefix = state.isReelingIn ? "[溜め] " : "";
    const stretchSuffix = stretch > 0.1 ? ` (+${stretch.toFixed(1)}m)` : "";
    return `${prefix}${distance.toFixed(1)}m / ${state.currentLength.toFixed(1)}m${stretchSuffix}`;
  },
  calculateImpulse: (player, state) => {
    const {
      minConstraintLength,
      constraintLengthMultiplier,
      ...elasticParams
    } = elasticHookshotDefinition.physics;
    return calculateElasticHookshot(player, state.anchor, {
      naturalLength: state.currentLength,
      extraCharge: state.extraCharge,
      maxLength: Math.max(
        minConstraintLength,
        state.currentLength * constraintLengthMultiplier,
      ),
      isReelingIn: state.isReelingIn,
      isChargeReleasing: state.isChargeReleasing,
      releaseShotPending: state.releaseShotPending,
      boostInputChargeControl: canUseGazeSteering(player),
      release: elasticHookshotDefinition.release,
      ...elasticParams,
    });
  },
};
