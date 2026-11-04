import { WireStyle } from "./types";

/**
 * リード（伸縮ゴム紐）のワイヤースタイル
 * 蜜蝋風の黄褐色カスタムパーティクル（1tick寿命）で、たるみ（sag）を表現
 */
export const ELASTIC_WIRE_STYLE: WireStyle = {
  particleId: "various_hookshot_addon:wire_elastic",
  stepDistance: 0.4,
  shapeMode: "sag",
  anchorParticleId: "various_hookshot_addon:wire_elastic",
  amplitude: 0.5,
};

/**
 * 剛体（糸）のワイヤースタイル
 * ピンと直線に張られた白い高密度ワイヤー（1tick寿命）
 */
export const RIGID_WIRE_STYLE: WireStyle = {
  particleId: "various_hookshot_addon:wire_rigid",
  stepDistance: 0.35,
  shapeMode: "straight",
  anchorParticleId: "various_hookshot_addon:wire_rigid",
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
