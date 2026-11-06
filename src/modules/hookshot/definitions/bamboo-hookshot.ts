import { Vector3Utils } from "@minecraft/math";
import { BAMBOO_WIRE_STYLE } from "../../render";
import {
  BambooPhysicsParams,
  calculateBambooHookshot,
} from "../math/bamboo-math";
import { HookshotDefinition } from "../types";

export const BAMBOO_HOOKSHOT_ID = "bamboo";
export const BAMBOO_ITEM_ID = "minecraft:bamboo";

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
};

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
        const bonus = Math.min(rawBonus, maxBonus);
        state.currentLength += bonus;
      }
    }
  },
};
