import { Vector3Utils } from "@minecraft/math";
import { Player, system, world } from "@minecraft/server";
import { PlayerStateManager } from "addon-utils";
import { BAMBOO_WIRE_STYLE } from "../../render";
import { EPSILON } from "../constants";
import {
  BambooPhysicsConfig,
  calculateBambooHookshot,
} from "../math/bamboo-math";
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

export const BAMBOO_HOOKSHOT_ID = "bamboo";
export const BAMBOO_ITEM_ID = "various_hookshot_addon:bamboo_hookshot";
export const BAMBOO_AIR_CHAIN_KEY = "bambooAirChainState";

/**
 * 竹フックショットの空中連続使用状態
 */
export interface BambooAirChainState {
  /** 着地せずに竹を使用した回数 (0: 未使用/接地済み, 1: 1回使用済み, 2: 2回使用済み...) */
  count: number;
  /** 現在竹フックに接続中かどうか */
  isHooked: boolean;
  /** 竹使用後に空中（非接地）にいたかどうか */
  hasBeenAirborne: boolean;
}

interface BambooTautState {
  hasCompressed: boolean;
  isTaut: boolean;
}

const bambooTautStates = new Map<string, BambooTautState>();

export interface BambooAirChainBonusConfig {
  /** 水平方向（X/Z 軸の走る速度）の接近速度に応じたしなりボーナス係数 (blocks per block/tick) */
  speedFlexBonusFactorXZ: number;
  /** 鉛直方向（Y 軸の落下・上昇速度）の接近速度に応じたしなりボーナス係数 (blocks per block/tick) */
  speedFlexBonusFactorY: number;
  /** 速度しなりボーナスの最大追加長 (blocks) */
  maxSpeedFlexBonus: number;
  /** 空中2回目以降のしなりボーナス倍率 (0.0〜1.0) */
  consecutiveAirBonusDecayRate: number;
}

export interface BambooTautSoundConfig {
  /** 竹がピンと張って減衰を開始するタイミングのSE */
  soundId: string;
  /** 竹がピンと張ったときのSEピッチ */
  pitch: number;
  /** 竹がピンと張ったときのSE音量 */
  volume: number;
}

let isTrackingInitialized = false;

/**
 * 竹フックショットの空中連続使用状態追跡（着地監視ループ）を初期化します。
 */
export function initBambooHookshotTracking(): void {
  if (isTrackingInitialized) return;
  isTrackingInitialized = true;

  system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
      if (!player.isValid) continue;

      const chain = PlayerStateManager.get<BambooAirChainState | null>(
        player.id,
        BAMBOO_AIR_CHAIN_KEY,
        null,
      );
      if (!chain) continue;

      const isGrounded =
        player.isOnGround || player.isInWater || player.isClimbing;

      if (!isGrounded) {
        // 空中にいる場合、空中フラグを立てる
        if (!chain.hasBeenAirborne) {
          chain.hasBeenAirborne = true;
          PlayerStateManager.set(player.id, BAMBOO_AIR_CHAIN_KEY, chain);
        }
      } else {
        // 接地している場合
        // 発射直後でまだ空中に飛び立つ前の助走期間中はリセットを保留
        if (chain.isHooked && !chain.hasBeenAirborne) {
          continue;
        }
        // 空中を経験した後に着地した、またはフック解除後に接地している場合はリセット
        PlayerStateManager.delete(player.id, BAMBOO_AIR_CHAIN_KEY);
      }
    }
  });
}

// モジュールロード時にも自動で初期化
initBambooHookshotTracking();

/**
 * 圧縮状態から伸び切り（ピンと張った状態）へ移行した瞬間にSEを再生します。
 */
function updateBambooTautSound(
  player: { id: string; location: { x: number; y: number; z: number }; playSound: (id: string, opts?: { volume?: number; pitch?: number }) => void },
  anchor: { x: number; y: number; z: number },
  currentLength: number,
): void {
  const taut = bambooTautStates.get(player.id);
  if (!taut) return;

  const dist = Vector3Utils.distance(player.location, anchor);
  if (dist < currentLength) {
    taut.hasCompressed = true;
    taut.isTaut = false;
    return;
  }

  if (taut.hasCompressed && !taut.isTaut) {
    taut.isTaut = true;
    const { soundId, volume, pitch } = bambooHookshotDefinition.tautSound;
    if (soundId) {
      try {
        player.playSound(soundId, { volume, pitch });
      } catch {}
    }
  }
}

export interface BambooHookshotState
  extends BaseHookshotState<typeof BAMBOO_HOOKSHOT_ID>,
    AirProbingState,
    RetractState,
    StepReelState {}

export interface BambooHookshotDefinition
  extends BaseHookshotDefinition<
      typeof BAMBOO_HOOKSHOT_ID,
      BambooHookshotState
    >,
    ReelCapable,
    AirProbingCapable,
    RetractCapable {
  /** 自然長を超えて指定距離 (blocks) 以上伸びた場合に自動でアンカーを解除する */
  maxOverstretchDistance: number;
  /** 自動解除時の効果音ID */
  detachSoundId: string;
  /** 竹ポールの弾性・反発・しなり物理パラメータ */
  physics: BambooPhysicsConfig;
  /** 着弾時の速度に応じたしなりボーナス設定 */
  airChainBonus: BambooAirChainBonusConfig;
  /** 竹がピンと張ったときの効果音設定 */
  tautSound: BambooTautSoundConfig;
}

/**
 * 竹（minecraft:bamboo）を使用した弾性圧縮ポール（しなる棒）フックショットの定義
 * 圧縮時にはフックの法則による弾性反発力（しなり）が働き、
 * 伸ばす際にはその一部がパーティクルのしなり解消方向（接線方向）へ分配されて跳躍を加速します。
 * 空中ジャンプ入力で短く（shorten）、シフト入力で長く（extend）
 */
export const bambooHookshotDefinition: BambooHookshotDefinition = {
  id: BAMBOO_HOOKSHOT_ID,
  itemTypeId: BAMBOO_ITEM_ID,
  maxDistance: 40,
  reel: {
    mode: "step",
    stepLength: 2.0,
    initialIntervalTicks: 7,
    minIntervalTicks: 2,
    intervalDecayTicks: 1,
    soundId: "block.bamboo.place",
  },
  reelMode: "extend",
  minRopeLength: 2.0,
  maxOverstretchDistance: 2.5,
  shotSoundId: "block.bamboo.step",
  detachSoundId: "block.bamboo.break",
  airProbing: {
    initialLength: 2.0,
    extend: {
      mode: "step",
      stepLength: 4.0,
      intervalTicks: 1,
      soundId: "block.bamboo.place",
    },
    minHitDistance: 1.5,
    hitSoundId: "block.bamboo.place",
  },
  retract: {
    mode: "step",
    stepLength: 2.0,
    intervalTicks: 1,
    soundId: "block.bamboo.place",
  },
  wireStyle: BAMBOO_WIRE_STYLE,
  physics: {
    flexibility: 1.0,
    baseStiffnessFactor: 0.14,
    maxCompression: 5.0,
    tangentTransferRatio: 0.7,
    damping: 0.02,
    maxAcceleration: 12,
    upwardDecayThreshold: 0.5,
    upwardMinScale: 0.25,
    upwardDecayExponent: 1.5,
    stretchOutwardRetention: 0.55,
    stretchHorizontalRetention: 0.88,
  },
  airChainBonus: {
    speedFlexBonusFactorXZ: 16.0,
    speedFlexBonusFactorY: 1.0,
    maxSpeedFlexBonus: 12.0,
    consecutiveAirBonusDecayRate: 0.5,
  },
  tautSound: {
    soundId: "block.bamboo.hit",
    pitch: 1.5,
    volume: 2.5,
  },
  calculateImpulse: (player, state) => {
    updateBambooTautSound(player, state.anchor, state.currentLength);

    return calculateBambooHookshot(player, state.anchor, {
      naturalLength: state.currentLength,
      surfaceNormal: state.normal,
      ...bambooHookshotDefinition.physics,
    });
  },
  shouldDetach: (_player, state, distance) =>
    distance - state.currentLength >=
    bambooHookshotDefinition.maxOverstretchDistance
      ? { detach: true }
      : { detach: false },
  onAttach: (player, state) => {
    const chain = PlayerStateManager.get<BambooAirChainState | null>(
      player.id,
      BAMBOO_AIR_CHAIN_KEY,
      null,
    );
    const airUses = chain?.count ?? 0;

    // 着弾した瞬間にアンカー（着弾）方向への速度を持っている場合、速度に応じたしなりボーナスを付与
    // （水平方向 X/Z と鉛直方向 Y で個別の重み係数を分離適用）
    const vel = player.getVelocity();
    const toAnchor = Vector3Utils.subtract(state.anchor, player.location);
    const dist = Vector3Utils.magnitude(toAnchor);
    if (dist > EPSILON) {
      const dirToAnchor = Vector3Utils.scale(toAnchor, 1 / dist);

      // 水平方向（X, Z）および鉛直方向（Y）それぞれのアンカー接近速度成分
      const inwardXZ = Math.max(
        0,
        vel.x * dirToAnchor.x + vel.z * dirToAnchor.z,
      );
      const inwardY = Math.max(0, vel.y * dirToAnchor.y);

      const {
        speedFlexBonusFactorXZ,
        speedFlexBonusFactorY,
        maxSpeedFlexBonus,
        consecutiveAirBonusDecayRate,
      } = bambooHookshotDefinition.airChainBonus;

      const rawBonus =
        inwardXZ * speedFlexBonusFactorXZ + inwardY * speedFlexBonusFactorY;
      if (rawBonus > 0) {
        let bonus = Math.min(rawBonus, maxSpeedFlexBonus);

        // 一度竹を使い、着地せずにもう一度竹を使用した場合（空中2回目以降）のしなりボーナス減衰処理
        if (airUses > 0) {
          const decayRate = Math.max(
            0,
            Math.min(1, consecutiveAirBonusDecayRate),
          );
          bonus *= decayRate;
        }

        if (bonus > EPSILON) {
          state.currentLength += bonus;
        }
      }
    }

    // 竹使用状態を記録（連続使用回数をインクリメント）
    bambooTautStates.set(player.id, {
      hasCompressed: false,
      isTaut: false,
    });
    PlayerStateManager.set(player.id, BAMBOO_AIR_CHAIN_KEY, {
      count: airUses + 1,
      isHooked: true,
      hasBeenAirborne: !player.isOnGround,
    });
  },
  onDetach: (player, _state) => {
    bambooTautStates.delete(player.id);
    const chain = PlayerStateManager.get<BambooAirChainState | null>(
      player.id,
      BAMBOO_AIR_CHAIN_KEY,
      null,
    );
    if (chain) {
      chain.isHooked = false;
      const isGrounded =
        player.isOnGround || player.isInWater || player.isClimbing;
      if (chain.hasBeenAirborne && isGrounded) {
        PlayerStateManager.delete(player.id, BAMBOO_AIR_CHAIN_KEY);
      } else {
        PlayerStateManager.set(player.id, BAMBOO_AIR_CHAIN_KEY, chain);
      }
    }
  },
};
