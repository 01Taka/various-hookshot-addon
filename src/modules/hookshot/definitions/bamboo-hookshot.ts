import { Vector3Utils } from "@minecraft/math";
import { system, world } from "@minecraft/server";
import { PlayerStateManager } from "addon-utils";
import { BAMBOO_WIRE_STYLE } from "../../render";
import {
  BambooPhysicsParams,
  calculateBambooHookshot,
} from "../math/bamboo-math";
import { HookshotDefinition } from "../types";

export const BAMBOO_HOOKSHOT_ID = "bamboo";
export const BAMBOO_ITEM_ID = "minecraft:bamboo";
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

/**
 * 竹フックショットの設定インターフェース
 */
export interface BambooHookshotConfig {
  /**
   * しなり具合・柔軟度 (flexibility)
   * 1.0 が標準。値が大きいほど柔らかく深くしなり、値が小さいほど硬くしなりにくくなります。
   */
  flexibility?: number;
  /** 圧縮時の弾性バネ定数（直接指定する場合） */
  compressionStiffness?: number;
  /** 最大しなり量（ブロック数）。これ以上竹が縮まない限界値 */
  maxCompression?: number;
  /**
   * 伸ばす際に接線方向（竹のしなり解消方向）へ振り分けるエネルギー比率 (0.0〜1.0)
   * デフォルト: 0.35 (35%)
   */
  tangentTransferRatio?: number;
  /**
   * 水平方向（X/Z 軸の走る速度）の接近速度に応じたしなりボーナス係数 (blocks per block/tick)。
   * デフォルト: 4.0
   */
  speedFlexBonusFactorXZ?: number;
  /**
   * 水平方向（X 軸）のしなりボーナス係数エイリアス
   */
  speedFlexBonusFactorX?: number;
  /**
   * 鉛直方向（Y 軸の落下・上昇速度）の接近速度に応じたしなりボーナス係数 (blocks per block/tick)。
   * デフォルト: 2.0
   */
  speedFlexBonusFactorY?: number;
  /**
   * 速度しなりボーナスの共通係数（未指定時のフォールバック用）
   */
  speedFlexBonusFactor?: number;
  /**
   * 速度しなりボーナスの最大追加長 (blocks)。
   * デフォルト: 3.5
   */
  maxSpeedFlexBonus?: number;
  /**
   * 一度竹を使用した後、着地せずにもう一度竹を使用した場合（空中2回目以降）のしなりボーナス倍率 (0.0〜1.0)。
   * 空中1回目は100%（減衰なし）、空中2回目でこの設定倍率に減衰し、3回目以降もこの倍率で固定されます。
   * - 1.0: 減衰なし（常に100%のボーナス）
   * - 0.5: 空中2回目以降はボーナスが50%で固定
   * - 0.0: 空中2回目以降はボーナスなし (0%)
   * デフォルト: 0.5
   */
  consecutiveAirBonusDecayRate?: number;
  /** consecutiveAirBonusDecayRate のエイリアス */
  consecutiveAirDecayRate?: number;
  /** consecutiveAirBonusDecayRate のエイリアス */
  consecutiveAirBonusDecay?: number;
  /** 動径減衰係数 */
  damping?: number;
  /** 最大反発加速度 */
  maxAcceleration?: number;
}

/**
 * 竹フックショットのグローバル設定
 * flexibility や tangentTransferRatio、maxCompression を変更することで、
 * しなりの深さや接線への打ち出し力を自由に変更可能です。
 */
export const bambooHookshotConfig: BambooHookshotConfig = {
  flexibility: 1.0,
  maxCompression: 5.0,
  tangentTransferRatio: 0.7,
  maxSpeedFlexBonus: 12.0,
  speedFlexBonusFactorXZ: 16.0,
  speedFlexBonusFactorY: 1.0,
  consecutiveAirBonusDecayRate: 0.5,
};

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
 * 竹（minecraft:bamboo）を使用した弾性圧縮ポール（しなる棒）フックショットの定義
 * 圧縮時にはフックの法則による弾性反発力（しなり）が働き、
 * 伸ばす際にはその一部がパーティクルのしなり解消方向（接線方向）へ分配されて跳躍を加速します。
 * 空中ジャンプ入力で短く（shorten）、シフト入力で長く（extend）
 */
export const bambooHookshotDefinition: HookshotDefinition = {
  id: BAMBOO_HOOKSHOT_ID,
  itemTypeId: BAMBOO_ITEM_ID,
  maxDistance: 40,
  reelSpeed: 0.8,
  reelMode: "extend",
  initialReelDelta: 0.0,
  minRopeLength: 1.5,
  wireStyle: BAMBOO_WIRE_STYLE,
  calculateImpulse: (player, state) => {
    return calculateBambooHookshot(player, state.anchor, {
      naturalLength: state.currentLength,
      surfaceNormal: state.normal,
      flexibility: bambooHookshotConfig.flexibility,
      compressionStiffness: bambooHookshotConfig.compressionStiffness,
      maxCompression: bambooHookshotConfig.maxCompression,
      tangentTransferRatio: bambooHookshotConfig.tangentTransferRatio,
      damping: bambooHookshotConfig.damping,
      maxAcceleration: bambooHookshotConfig.maxAcceleration,
    });
  },
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
    if (dist > 0.0001) {
      const dirToAnchor = Vector3Utils.scale(toAnchor, 1 / dist);

      // 水平方向（X, Z）および鉛直方向（Y）それぞれのアンカー接近速度成分
      const inwardXZ = Math.max(
        0,
        vel.x * dirToAnchor.x + vel.z * dirToAnchor.z,
      );
      const inwardY = Math.max(0, vel.y * dirToAnchor.y);

      const factorXZ =
        bambooHookshotConfig.speedFlexBonusFactorXZ ??
        bambooHookshotConfig.speedFlexBonusFactorX ??
        bambooHookshotConfig.speedFlexBonusFactor ??
        4.0;
      const factorY =
        bambooHookshotConfig.speedFlexBonusFactorY ??
        bambooHookshotConfig.speedFlexBonusFactor ??
        2.0;

      const rawBonus = inwardXZ * factorXZ + inwardY * factorY;
      if (rawBonus > 0) {
        const maxBonus = bambooHookshotConfig.maxSpeedFlexBonus ?? 3.5;
        let bonus = Math.min(rawBonus, maxBonus);

        // 一度竹を使い、着地せずにもう一度竹を使用した場合（空中2回目以降）のしなりボーナス減衰処理
        if (airUses > 0) {
          const decayRate = Math.max(
            0,
            Math.min(
              1,
              bambooHookshotConfig.consecutiveAirBonusDecayRate ??
                bambooHookshotConfig.consecutiveAirDecayRate ??
                bambooHookshotConfig.consecutiveAirBonusDecay ??
                0.5,
            ),
          );
          bonus *= decayRate;
        }

        if (bonus > 0.0001) {
          state.currentLength += bonus;
        }
      }
    }

    // 竹使用状態を記録（連続使用回数をインクリメント）
    PlayerStateManager.set(player.id, BAMBOO_AIR_CHAIN_KEY, {
      count: airUses + 1,
      isHooked: true,
      hasBeenAirborne: !player.isOnGround,
    });
  },
  onDetach: (player, _state) => {
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
