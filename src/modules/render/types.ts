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
  /** 自然長に対する距離比率 (dist / currentLength) に応じて間隔を変化させるか */
  ratioSpacing?: boolean;
  /** 1スライスあたりに円周配置するパーティクル数 (設定時はリング状チューブ描画) */
  ringSliceParticles?: number;
  /** 自然長に対する距離比率に応じてリング半径・粒サイズを変化させるか */
  ringRadiusScaling?: boolean;
  /** 自然長時のリング半径 (blocks) */
  baseRingRadius?: number;
  /** 最大伸長時の最小リング半径 (blocks) */
  minRingRadius?: number;
  /** 最大圧縮時の最大リング半径 (blocks) */
  maxRingRadius?: number;
  /** 隣接スライス間でリング角度を半ステップずらして網目状に配置するか */
  ringStagger?: boolean;
  /** 2軸スコア合成時の全体長スコア重み (0〜1, 残りが自然長比率の重み) */
  lengthScoreWeight?: number;
  /** 全体長スコアが最大(1.0)になる距離 (blocks) */
  scoreMinDistance?: number;
  /** 全体長スコアが最小(0.0)になる距離 (blocks) */
  scoreMaxDistance?: number;
  /** 伸縮スコアが最大(1.0)になる距離比率 (dist / currentLength) */
  scoreMinRatio?: number;
  /** 伸縮スコアが最小(0.0)になる距離比率 (dist / currentLength) */
  scoreMaxRatio?: number;
  /** 伸縮スコアを絶対差 (dist - currentLength) ベースで計算する際の中立オフセット (blocks, 例: -2.0) */
  scoreDiffCenter?: number;
  /** 伸縮スコアを絶対差ベースで計算する際の最大振幅 (blocks, 例: 15.0) */
  scoreDiffRange?: number;
  /** 絶対差ベースの非線形カーブ指数 (<1 で中央付近の変化を強調, 例: 0.65) */
  scoreDiffExponent?: number;
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
