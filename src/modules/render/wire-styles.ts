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
  elasticSensitivity: 3.0,
  maxStepDistance: 2.6,
  minStepDistance: 0.08,
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
 * 螺旋（スプリングコイル）状に波打つ緑色のカスタムパーティクル（1tick寿命）
 */
export const SPRING_WIRE_STYLE: WireStyle = {
  particleId: "various_hookshot_addon:wire_spring",
  stepDistance: 0.3,
  shapeMode: "spring",
  anchorParticleId: "various_hookshot_addon:wire_spring",
  amplitude: 0.22,
};

/**
 * パスファインダー型（鉄インゴット）のワイヤースタイル
 * 青白い電気スパークによる高張力ケーブル（1tick寿命）
 */
export const PATHFINDER_WIRE_STYLE: WireStyle = {
  particleId: "various_hookshot_addon:wire_pathfinder",
  stepDistance: 0.45,
  shapeMode: "straight",
  anchorParticleId: "various_hookshot_addon:wire_pathfinder",
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

