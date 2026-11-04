import { Vector3 } from "@minecraft/server";

export type WireShapeMode = "straight" | "sag" | "spring";

export interface WireStyle {
  /** 使用するパーティクルID (例: "minecraft:basic_crit_particle") */
  particleId: string;
  /** パーティクル配置の基本間隔 (blocks, 例: 0.35〜0.6) */
  stepDistance: number;
  /** 形状モード ("straight": 直線, "sag": たるみ, "spring": コイルばね) */
  shapeMode: WireShapeMode;
  /** アンカー先端（着弾点）に表示するパーティクルID (省略可) */
  anchorParticleId?: string;
  /** たるみの最大深度係数、またはばねの半径 */
  amplitude?: number;
}

export interface WireRenderContext {
  dimensionId: string;
  start: Vector3;
  end: Vector3;
  /** 現在のロープ設定長 (たるみ計算用) */
  currentLength?: number;
  style: WireStyle;
}
