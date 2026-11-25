import { Vector3 } from "@minecraft/server";
import { MAGNET_GUIDE_WIRE_STYLE } from "../../render";
import {
  calculateMagnetHookshot,
  MagnetForceMode,
  MagnetNode,
  MagnetPhysicsConfig,
} from "../math/magnet-math";
import { BaseHookshotDefinition, BaseHookshotState } from "../types";

export const MAGNET_HOOKSHOT_ID = "magnet";
export const MAGNET_ITEM_ID = "various_hookshot_addon:magnet_hookshot";

/** 金属・磁性体ブロックボーナス（1.4倍）の対象ブロックID一覧 */
export const METALLIC_MAGNET_BLOCK_IDS = new Set<string>([
  "minecraft:iron_block",
  "minecraft:raw_iron_block",
  "minecraft:iron_ore",
  "minecraft:deepslate_iron_ore",
  "minecraft:iron_bars",
  "minecraft:iron_door",
  "minecraft:iron_trapdoor",
  "minecraft:heavy_weighted_pressure_plate",
  "minecraft:chain",
  "minecraft:iron_chain",
  "minecraft:hopper",
  "minecraft:anvil",
  "minecraft:chipped_anvil",
  "minecraft:damaged_anvil",
  "minecraft:lodestone",
  "minecraft:netherite_block",
  "minecraft:ancient_debris",
  "minecraft:cauldron",
  "minecraft:rail",
  "minecraft:powered_rail",
  "minecraft:detector_rail",
  "minecraft:activator_rail",
]);

export function isMetallicMagnetBlock(typeId: string): boolean {
  return METALLIC_MAGNET_BLOCK_IDS.has(typeId);
}

export interface MagnetHookshotState
  extends BaseHookshotState<typeof MAGNET_HOOKSHOT_ID> {
  /** 現在磁化されているブロック一覧（最大3個, FIFO） */
  nodes: MagnetNode[];
  /** 現在発動中の磁力モード */
  activeMode: MagnetForceMode;
  /** 着地後、初回起動（遅延あり＋初動ブースト）が未消化かどうか */
  isFirstActivationPending: boolean;
  /** 初回起動または空中で一度地面から離れたか（地上ブースト直後の即リセット防止） */
  hasLeftGroundSinceActivation: boolean;
  /** 初回起動チャージ中に入力しているモード */
  chargeInputMode: MagnetForceMode;
  /** 初回起動チャージの連続入力Tick数 */
  chargeTicks: number;
  /** 今Tickで初回ブーストを発動するか */
  boostPendingTick: boolean;
  /** 動作音再生の直近Tick */
  lastActiveSoundTick?: number;
}

export interface MagnetHookshotDefinition
  extends BaseHookshotDefinition<
    typeof MAGNET_HOOKSHOT_ID,
    MagnetHookshotState
  > {
  /** 最大同時磁化ブロック数 */
  maxNodes: number;
  /** 磁化ブロックから自動消滅する離脱距離 (blocks) */
  maxDetachDistance: number;
  /** 着弾（磁化成功）時の効果音ID */
  hitSoundId: string;
  /** 不発（空撃ち）時の効果音ID */
  missSoundId: string;
  /** 全解除時の効果音ID */
  detachSoundId: string;
  /** チャージ完了（初動ブースト）時の効果音ID */
  boostSoundId: string;
  /** 磁力稼働中のループ効果音設定 */
  activeSound: {
    soundId: string;
    intervalTicks: number;
  };
  /** 物理パラメータ */
  physics: MagnetPhysicsConfig;
}

export const magnetHookshotDefinition: MagnetHookshotDefinition = {
  id: MAGNET_HOOKSHOT_ID,
  itemTypeId: MAGNET_ITEM_ID,
  maxDistance: 60,
  maxNodes: 3,
  maxDetachDistance: 200,
  reel: {
    mode: "continuous",
    speed: 0,
  },
  reelMode: "shorten",
  minRopeLength: 0,
  wireStyle: MAGNET_GUIDE_WIRE_STYLE,
  shotSoundId: "crossbow.shoot",
  hitSoundId: "block.lodestone.place",
  missSoundId: "note.bass",
  detachSoundId: "beacon.deactivate",
  boostSoundId: "beacon.power",
  activeSound: {
    soundId: "beacon.ambient",
    intervalTicks: 10,
  },
  physics: {
    baseAccel: 0.24,
    initialBoostMultiplier: 2.6,
    initialBoostGroundLiftY: 0.24,
    r0: 4.0,
    decayExponent: 0.68,
    maxTotalAccel: 0.65,
    maxSpeedSingle: 1.85,
    maxSpeedDouble: 2.35,
    maxSpeedTriple: 2.8,
    startupDelayTicks: 5,
    metallicMultiplier: 1.4,
  },
  calculateImpulse: (player, state): Vector3 => {
    return calculateMagnetHookshot(
      player,
      state.nodes,
      state.activeMode,
      state.boostPendingTick,
      magnetHookshotDefinition.physics,
    );
  },
};
