import { Player, Vector3 } from "@minecraft/server";
import { WireStyle } from "../render/types";

export type AnchorPosition = Vector3 & { dimensionId: string };

export interface HookshotState {
  hookshotId: string;
  anchor: AnchorPosition;
  /** アンカー確定済みかどうか（省略時は true 扱い、false は未着弾の構え状態） */
  isAnchored?: boolean;
  /** 構え中の固定方向ベクトル（単位ベクトル） */
  probingDirection?: Vector3;
  /** 構え中の自動伸長が有効かどうか */
  isAutoExtending?: boolean;
  /** 自動ステップ伸長の直近実行Tick */
  lastAutoExtendTick?: number;
  /** 着弾面の法線ベクトル（外向き） */
  normal?: Vector3;
  /** アンカーからプレイヤーへ向かう、フック着弾（刺さった）瞬間の初期方向ベクトル（単位ベクトル） */
  initialDirection?: Vector3;
  currentLength: number;
  jumpConsumed?: boolean;
  sneakConsumed?: boolean;
  /** 空中ジャンプ入力によって現在短縮（巻き取り）中かどうか */
  isReelingIn?: boolean;
  /** ステップ伸縮の直近実行Tick */
  lastStepReelTick?: number;
  /** ステップ伸縮の現在の待機間隔（Tick） */
  currentStepIntervalTicks?: number;
  /** 直近のステップ伸縮方向（方向転換時のリセット判定用） */
  lastStepMode?: ReelMode;
  /** 連続伸縮時の効果音再生直近Tick */
  lastContinuousReelSoundTick?: number;
}

export type ReelMode = "shorten" | "extend";

export type ReelConfig =
  | {
      mode: "continuous";
      /** 継続的な長さ変更速度 (blocks/tick) */
      speed: number;
      /** ボタンを押した瞬間に追加で一気に変更する瞬間変化量 (blocks, 単一数値または { shorten?, extend? } で指定可能) */
      initialDelta?: number | { shorten?: number; extend?: number };
      /** 連続伸縮時の効果音ID */
      soundId?: string;
      /** 連続伸縮時の効果音再生間隔 (ticks, デフォルト: 4) */
      soundIntervalTicks?: number;
    }
  | {
      mode: "step";
      /** 1ステップあたりの長さ変化量 (blocks) */
      stepLength: number;
      /** 初回長押し間隔 (ticks) */
      initialIntervalTicks: number;
      /** 最小間隔 (ticks) */
      minIntervalTicks: number;
      /** 1ステップごとに短縮するTick数 */
      intervalDecayTicks: number;
      /** ステップ伸縮時の効果音ID */
      soundId?: string;
    };

export type AirProbingExtendConfig =
  | {
      mode: "continuous";
      /** 着弾までに自動で伸びる速度 (blocks/tick) */
      speed: number;
      /** 自動伸長時の効果音ID */
      soundId?: string;
      /** 自動伸長時の効果音再生間隔 (ticks, デフォルト: 2) */
      soundIntervalTicks?: number;
    }
  | {
      mode: "step";
      /** 1ステップで伸びる長さ (blocks) */
      stepLength: number;
      /** 何Tickごとに伸びるか (ticks) */
      intervalTicks: number;
      /** ステップ伸長時の効果音ID */
      soundId?: string;
    };

export interface AirProbingConfig {
  /** 発射直後の初期長 (blocks) */
  initialLength: number;
  /** 着弾までの自動伸長設定 */
  extend: AirProbingExtendConfig;
  /** 手元・足元の誤爆防止で除外する最小距離 (blocks, デフォルト: 1.5) */
  minHitDistance?: number;
  /** 構えからブロックに刺さった時の効果音ID */
  hitSoundId?: string;
}

export interface HookshotDefinition {
  /** 一意な識別子 (例: "elastic", "rigid", "rod", "spring") */
  id: string;
  /** 使用するアイテムの typeId (例: "minecraft:lead", "minecraft:string") */
  itemTypeId: string;
  /** Raycast の最大射程距離 (blocks, デフォルト: 1200) */
  maxDistance?: number;
  /** ロープ長の変更挙動設定（連続またはステップ） */
  reel?: ReelConfig;
  /** 長さ変更の挙動モード ("shorten": 縮む, "extend": 伸びる, デフォルト: "shorten") */
  reelMode?: ReelMode;
  /** 最小ロープ長 (blocks, デフォルト: 1.5) */
  minRopeLength?: number;
  /** 最大ロープ長 (blocks, デフォルト: maxDistance または 1200) */
  maxRopeLength?: number;
  /** ワイヤーの描画スタイル（パーティクル、形状モードなど） */
  wireStyle?: WireStyle;
  /** ワイヤー描画時の基準軸（法線または曲げ軸）を解決するコールバック（省略時は state.normal が使用されます） */
  getWireAxis?: (state: HookshotState) => Vector3 | undefined;
  /** 視線ステアリング推進力を有効にするかどうか */
  enableGazeSteering?: boolean;
  /** 未着弾構え・自動伸長の設定 */
  airProbing?: AirProbingConfig;
  /** 発射時にブロックへ当たらなかった場合、指定Tick数の間だけ視線方向へのレイキャスト探索を継続する */
  raycastGraceTicks?: number;
  /** 最大長まで伸ばしきった状態で、伸ばすボタン押下中に自然長を超えた（最高速度到達）時に自動解除するか */
  detachOnMaxExtend?: boolean;
  /** 自然長以上へ到達した際、外側への動径速度 (blocks/tick) がこの値以上なら自動でアンカーを解除する */
  detachOnOutwardSpeed?: number;
  /** 自動解除時の効果音ID */
  detachSoundId?: string;
  /** 発射時の効果音ID */
  shotSoundId?: string;
  /** 着弾（アンカー確定）時の効果音ID */
  hitSoundId?: string;
  /** 毎Tickの物理インパルス計算 */
  calculateImpulse: (player: Player, state: HookshotState) => Vector3;
  /** フック接続時のコールバック (演出など任意) */
  onAttach?: (player: Player, state: HookshotState) => void;
  /** フック解除時のコールバック (演出など任意) */
  onDetach?: (player: Player, state: HookshotState) => void;
}

