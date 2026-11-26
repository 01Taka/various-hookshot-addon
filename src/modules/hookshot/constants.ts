/**
 * フックショットシステム全体で共有する技術的・物理的定数。
 * ※ ゲームバランス調整に影響するパラメータは各 definitions/*.ts の HookshotDefinition に配置し、
 *    ここには「その値であることに技術的・物理的意味がある定数」のみを定義します。
 */

/** ゼロ除算や縮退ベクトル判定を防ぐための微小値 */
export const EPSILON = 0.0001;

/** 移動入力（スティック・キー）の無反応デッドゾーン */
export const INPUT_DEADZONE = 0.05;

/** Minecraft の標準 Tick レート (20 ticks / sec) */
export const TICKS_PER_SECOND = 20;

/** プレイヤー座標（足元）から胸の高さまでのオフセット (blocks) */
export const PLAYER_CHEST_HEIGHT_OFFSET = 1.0;

/** アンカーとプレイヤー位置がほぼ重なった場合に法線へフォールバックする閾値距離 (blocks) */
export const PROJECTION_FALLBACK_DISTANCE = 0.25;

/** 標準空中水平空気抵抗 (XZ) */
export const AIR_DRAG_BASE = 0.99;

/** 過剰加速防止の動的空気抵抗が効き始める速度閾値 (blocks/tick) */
export const AIR_DRAG_SPEED_THRESHOLD = 2.4;

/** 過剰加速防止の動的空気抵抗における二次減衰係数 */
export const AIR_DRAG_COEFFICIENT = 0.4;

/** 格納アニメーションを開始する最小距離閾値 (blocks) */
export const RETRACT_START_MIN_DISTANCE = 0.1;

/** 格納アニメーションを完了とみなす最小残り距離閾値 (blocks) */
export const RETRACT_END_MIN_DISTANCE = 0.05;
