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
  maxDistance: 48,
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
};
