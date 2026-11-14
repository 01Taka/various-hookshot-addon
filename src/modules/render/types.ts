import { Vector3 } from "@minecraft/server";

export type WireShapeMode = "straight" | "sag" | "spring" | "bent";

export interface WireStyle {
  /** 使用するパーティクルID (例: "minecraft:basic_crit_particle") */
  particleId: string;
  /** パーティクル配置の基本間隔 (blocks, 例: 0.35〜0.6) */
  stepDistance: number;
  /** 形状モード ("straight": 直線, "sag": たるみ, "spring": コイルばね, "bent": 荷重しなり) */
  shapeMode: WireShapeMode;
  /** アンカー先端（着弾点）に表示するパーティクルID (省略可) */
  anchorParticleId?: string;
  /** たるみの最大深度係数、またはばねの半径 */
  amplitude?: number;
  /** 自然長に対する伸縮比率に応じてパーティクル間隔を変化させるか (ゴム紐用) */
  elasticSpacing?: boolean;
  /** 伸びた時の伸縮感度指数 (デフォルト 3.0: 伸びた時に大きく間隔が開く) */
  elasticSensitivity?: number;
  /** 伸びの絶対差を基準にする場合の最大基準距離 (blocks, 指定時は stretch = max(0, dist - currentLength) + extraCharge で計算) */
  elasticReferenceStretch?: number;
  /** 伸縮に応じてパーティクルサイズ (variable.wire_size) を変化させるか */
  elasticSizeScaling?: boolean;
  /** 通常時 (stretch = 0) のパーティクルサイズ */
  baseParticleSize?: number;
  /** 最大伸び時 (elasticReferenceStretch 到達時) の最小パーティクルサイズ */
  minParticleSize?: number;
  /** たるみ時の最大パーティクルサイズ */
  maxParticleSize?: number;
  /** パーティクル間隔の最大上限 (blocks, 間が空きすぎないように制限) */
  maxStepDistance?: number;
  /** パーティクル間隔の最小下限 (blocks, 詰まりすぎ防止) */
  minStepDistance?: number;
}

export interface WireRenderContext {
  dimensionId: string;
  start: Vector3;
  end: Vector3;
  /** 着弾面の法線ベクトル、または曲げバネ・しなりの基準軸ベクトル */
  normal?: Vector3;
  /** 現在のロープ設定長 (たるみ計算用) */
  currentLength?: number;
  /** 最小ロープ長到達後に蓄積された追加チャージ量 */
  extraCharge?: number;
  style: WireStyle;
}
