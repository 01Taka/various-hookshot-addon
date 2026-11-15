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

/** 剛体・限界長拘束における Baumgarte 位置誤差安定化係数 */
export const BAUMGARTE_FACTOR = 0.15;

/** 限界圧縮底打ち拘束における Baumgarte 位置誤差安定化係数 */
export const BAUMGARTE_BOTTOM_OUT = 0.2;

/** 剛体ロープの同期遅延による発振を防ぐ動径補正ゲイン */
export const RADIAL_CORRECTION_GAIN = 0.7;

/** 標準空中水平空気抵抗 (XZ) */
export const AIR_DRAG_BASE = 0.99;

/** 過剰加速防止の動的空気抵抗が効き始める速度閾値 (blocks/tick) */
export const AIR_DRAG_SPEED_THRESHOLD = 2.4;

/** 過剰加速防止の動的空気抵抗における二次減衰係数 */
export const AIR_DRAG_COEFFICIENT = 0.4;

/** 構え前プレビュー距離UIの最小レイキャスト距離 (blocks) */
export const PREVIEW_MIN_RAYCAST_DISTANCE = 250;

/** 格納アニメーションを開始する最小距離閾値 (blocks) */
export const RETRACT_START_MIN_DISTANCE = 0.1;

/** 格納アニメーションを完了とみなす残り距離閾値 (blocks) */
export const RETRACT_END_THRESHOLD = 0.05;

/** 未着弾構え時の最小ヒット除外距離のフォールバック値 (blocks) */
export const DEFAULT_PROBING_MIN_HIT_DISTANCE = 1.5;

/** 連続伸縮時の効果音再生間隔フォールバック値 (ticks) */
export const DEFAULT_CONTINUOUS_SOUND_INTERVAL_TICKS = 4;

/** ステップ／自動伸長・格納時の効果音再生間隔フォールバック値 (ticks) */
export const DEFAULT_TIMED_SOUND_INTERVAL_TICKS = 2;
