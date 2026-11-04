import { Player, Vector3 } from "@minecraft/server";

export type AnchorPosition = Vector3 & { dimensionId: string };

export interface HookshotState {
  hookshotId: string;
  anchor: AnchorPosition;
  currentLength: number;
}

export interface HookshotDefinition {
  /** 一意な識別子 (例: "elastic", "rigid") */
  id: string;
  /** 使用するアイテムの typeId (例: "minecraft:lead", "minecraft:string") */
  itemTypeId: string;
  /** Raycast の最大射程距離 (blocks, デフォルト: 1200) */
  maxDistance?: number;
  /** スニーク時の巻き取り速度 (blocks/tick, デフォルト: 1.25) */
  reelSpeed?: number;
  /** 最小ロープ長 (blocks, デフォルト: 1.5) */
  minRopeLength?: number;
  /** 毎Tickの物理インパルス計算 */
  calculateImpulse: (player: Player, state: HookshotState) => Vector3;
  /** フック接続時のコールバック (演出など任意) */
  onAttach?: (player: Player, state: HookshotState) => void;
  /** フック解除時のコールバック (演出など任意) */
  onDetach?: (player: Player, state: HookshotState) => void;
}
