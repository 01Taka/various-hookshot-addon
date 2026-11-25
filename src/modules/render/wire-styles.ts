import { BlockOutlineStyle } from "./block-outline-renderer";
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
  elasticReferenceStretch: 90.0,
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
  maxRingRadius: 0.8,
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

/**
 * ジップライン支柱（木製フェンス／杭）のワイヤースタイル
 */
export const ZIPLINE_PILLAR_STYLE: WireStyle = {
  particleId: "various_hookshot_addon:wire_zipline_pillar",
  stepDistance: 0.45,
  shapeMode: "straight",
  anchorParticleId: "various_hookshot_addon:wire_zipline_pillar",
};

/**
 * ジップラインレール（始点〜終点の張り糸）のワイヤースタイル
 */
export const ZIPLINE_RAIL_STYLE: WireStyle = {
  particleId: "various_hookshot_addon:wire_rigid",
  stepDistance: 1.0,
  shapeMode: "straight",
  anchorParticleId: "various_hookshot_addon:wire_rigid",
  viewerStepScaling: true,
  viewerScaleStartDist: 5.0,
  viewerScaleEndDist: 40.0,
  viewerScaleMaxMultiplier: 2.5,
};

/**
 * ジップライン吊り下げ鎖のワイヤースタイル
 */
export const ZIPLINE_WIRE_STYLE: WireStyle = {
  particleId: "various_hookshot_addon:wire_rigid",
  stepDistance: 0.55,
  shapeMode: "sag",
  anchorParticleId: "various_hookshot_addon:wire_rigid",
  amplitude: 0.35,
};

/**
 * ジップライン支持ブロック囲み枠線のスタイル（柵と同じ木色）
 */
export const ZIPLINE_SUPPORT_OUTLINE_STYLE: BlockOutlineStyle = {
  particleId: "various_hookshot_addon:block_outline",
  stepDistance: 0.25,
  padding: 0.03,
  particleSize: 0.08,
  color: { r: 0.58, g: 0.4, b: 0.22, a: 0.95 },
};

/**
 * マグネットフックの待機・チャージ中の磁力ガイド線（薄灰青）
 */
export const MAGNET_GUIDE_WIRE_STYLE: WireStyle = {
  particleId: "various_hookshot_addon:wire_magnet_guide",
  stepDistance: 1.1,
  shapeMode: "straight",
  anchorParticleId: "various_hookshot_addon:wire_magnet_guide",
};

/**
 * マグネットフックの吸引中（Shift）の磁力線（青系）
 */
export const MAGNET_ATTRACT_WIRE_STYLE: WireStyle = {
  particleId: "various_hookshot_addon:wire_magnet_attract",
  stepDistance: 0.55,
  shapeMode: "straight",
  anchorParticleId: "various_hookshot_addon:wire_magnet_attract",
};

/**
 * マグネットフックの反発中（Jump）の磁力線（赤系）
 */
export const MAGNET_REPEL_WIRE_STYLE: WireStyle = {
  particleId: "various_hookshot_addon:wire_magnet_repel",
  stepDistance: 0.55,
  shapeMode: "straight",
  anchorParticleId: "various_hookshot_addon:wire_magnet_repel",
};

/**
 * マグネットフックの通常磁化ブロック囲み枠線（紫青系）
 */
export const MAGNET_NODE_OUTLINE_STYLE: BlockOutlineStyle = {
  particleId: "various_hookshot_addon:block_outline",
  stepDistance: 0.35,
  padding: 0.04,
  particleSize: 0.09,
  color: { r: 0.35, g: 0.72, b: 1.0, a: 0.9 },
};

/**
 * マグネットフックの金属ボーナス磁化ブロック囲み枠線（黄金＋電撃系）
 */
export const MAGNET_METALLIC_OUTLINE_STYLE: BlockOutlineStyle = {
  particleId: "various_hookshot_addon:block_outline",
  stepDistance: 0.25,
  padding: 0.05,
  particleSize: 0.12,
  color: { r: 1.0, g: 0.82, b: 0.2, a: 0.98 },
};
