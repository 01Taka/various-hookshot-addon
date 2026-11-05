import { Player, Vector3 } from "@minecraft/server";
import { WireStyle } from "../render/types";

export type AnchorPosition = Vector3 & { dimensionId: string };

export interface HookshotState {
  hookshotId: string;
  anchor: AnchorPosition;
  /** 着弾面の法線ベクトル（外向き） */
  normal?: Vector3;
  currentLength: number;
  jumpConsumed?: boolean;
  sneakConsumed?: boolean;
}

export type ReelMode = "shorten" | "extend";

export interface HookshotDefinition {
  /** 一意な識別子 (例: "elastic", "rigid", "rod", "spring") */
  id: string;
  /** 使用するアイテムの typeId (例: "minecraft:lead", "minecraft:string") */
  itemTypeId: string;
  /** Raycast の最大射程距離 (blocks, デフォルト: 1200) */
  maxDistance?: number;
  /** ジャンプ/シフト入力時の継続的な長さ変更速度 (blocks/tick, デフォルト: 1.25) */
  reelSpeed?: number;
  /** ボタンを押した瞬間に追加で一気に変更する瞬間変化量 (blocks, 単一数値または { shorten?, extend? } で指定可能。デフォルト: 0) */
  initialReelDelta?: number | { shorten?: number; extend?: number };
  /** 長さ変更の挙動モード ("shorten": 縮む, "extend": 伸びる, デフォルト: "shorten") */
  reelMode?: ReelMode;
  /** 最小ロープ長 (blocks, デフォルト: 1.5) */
  minRopeLength?: number;
  /** 最大ロープ長 (blocks, デフォルト: maxDistance または 1200) */
  maxRopeLength?: number;
  /** ワイヤーの描画スタイル（パーティクル、形状モードなど） */
  wireStyle?: WireStyle;
  /** 毎Tickの物理インパルス計算 */
  calculateImpulse: (player: Player, state: HookshotState) => Vector3;
  /** フック接続時のコールバック (演出など任意) */
  onAttach?: (player: Player, state: HookshotState) => void;
  /** フック解除時のコールバック (演出など任意) */
  onDetach?: (player: Player, state: HookshotState) => void;
}

