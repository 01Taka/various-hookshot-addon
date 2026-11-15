import { WireStyle } from "./types";

/**
 * リード（伸縮ゴム紐）のワイヤースタイル
 * 蜜蝋風の黄褐色カスタムパーティクル（1tick寿命）で、たるみ（sag）を表現
 */
export const ELASTIC_WIRE_STYLE: WireStyle = {
  particleId: "various_hookshot_addon:wire_elastic",
  stepDistance: 0.8,
  shapeMode: "sag",
  anchorParticleId: "various_hookshot_addon:wire_elastic",
  amplitude: 0.5,
  elasticSpacing: true,
  elasticReferenceStretch: 75.0,
  maxStepDistance: 3.2,
  minStepDistance: 0.08,
  elasticSizeScaling: true,
  baseParticleSize: 0.2,
  minParticleSize: 0.07,
  maxParticleSize: 0.28,
};

/**
 * 剛体（糸）のワイヤースタイル
 * 白い高密度ワイヤー（1tick寿命）で、たるみ（sag）を表現
 */
export const RIGID_WIRE_STYLE: WireStyle = {
  particleId: "various_hookshot_addon:wire_rigid",
  stepDistance: 0.8,
  shapeMode: "sag",
  anchorParticleId: "various_hookshot_addon:wire_rigid",
  amplitude: 0.5,
};

/**
 * ロッド（棒）のワイヤースタイル
 * 光り輝くロッドビーム（1tick寿命）
 */
export const ROD_WIRE_STYLE: WireStyle = {
  particleId: "various_hookshot_addon:wire_rod",
  stepDistance: 0.5,
  shapeMode: "straight",
  anchorParticleId: "various_hookshot_addon:wire_rod",
};

/**
 * ばね（スライムボール）のワイヤースタイル
 * カメラ正面を向く半透明スライム粒子を1スライス4個のリング状に並べてチューブを表現し、
 * 自然長に対する伸縮比率に応じてリング半径・粒サイズ・スライス間隔を変化させる
 */
export const SPRING_WIRE_STYLE: WireStyle = {
  particleId: "various_hookshot_addon:wire_spring",
  stepDistance: 0.68,
  shapeMode: "spring",
  anchorParticleId: "various_hookshot_addon:wire_spring",
  ratioSpacing: true,
  minStepDistance: 0.25,
  maxStepDistance: 1.8,
  ringSliceParticles: 4,
  ringRadiusScaling: true,
  baseRingRadius: 0.45,
  minRingRadius: 0.05,
  maxRingRadius: 1.0,
  ringStagger: true,
  baseParticleSize: 0.14,
  minParticleSize: 0.07,
  maxParticleSize: 0.22,
  lengthScoreWeight: 0.25,
  scoreMinDistance: 2.0,
  scoreMaxDistance: 40.0,
  scoreDiffCenter: -2.5,
  scoreDiffRange: 15.0,
  scoreDiffExponent: 0.65,
};

/**
 * 竹（しなる棒高跳びポール）のワイヤースタイル
 * 鮮やかな竹色パーティクルで、圧縮荷重に応じたしなり（bent）を表現
 */
export const BAMBOO_WIRE_STYLE: WireStyle = {
  particleId: "various_hookshot_addon:wire_bamboo",
  stepDistance: 0.4,
  shapeMode: "bent",
  anchorParticleId: "various_hookshot_addon:wire_bamboo",
  amplitude: 0.85,
};
