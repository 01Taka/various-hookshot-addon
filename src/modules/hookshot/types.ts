import { Player, Vector3 } from "@minecraft/server";
import { WireStyle } from "../render/types";
import type {
  BambooHookshotDefinition,
  BambooHookshotState,
} from "./definitions/bamboo-hookshot";
import type {
  ElasticHookshotDefinition,
  ElasticHookshotState,
} from "./definitions/elastic-hookshot";
import type {
  RigidHookshotDefinition,
  RigidHookshotState,
} from "./definitions/rigid-hookshot";
import type {
  RodHookshotDefinition,
  RodHookshotState,
} from "./definitions/rod-hookshot";
import type {
  SpringHookshotDefinition,
  SpringHookshotState,
} from "./definitions/spring-hookshot";

export type HookshotId = "bamboo" | "elastic" | "rigid" | "rod" | "spring";

export type AnchorPosition = Vector3 & { dimensionId: string };

export type ReelMode = "shorten" | "extend";

export type ReelConfig =
  | {
      mode: "continuous";
      /** 継続的な長さ変更速度 (blocks/tick, 単一数値または { shorten, extend } で指定可能) */
      speed: number | { shorten: number; extend: number };
      /** 距離が自然長以下（たるみ中）のときの短縮速度 (blocks/tick, 省略時は speed と同じ) */
      slackSpeed?: number;
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

export type RetractConfig = AirProbingExtendConfig;

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

export interface ChargeMilestoneSoundConfig {
  /** 鳴らす効果音ID */
  soundId: string;
  /** マイルストーン間隔 (blocks, 例: 15) */
  step: number;
  /** 鳴動対象となる最大の伸び量 (blocks, 例: 75) */
  maxStretch: number;
  /** 同じ地点を再鳴動するために必要な距離差 (blocks, 例: 5) */
  hysteresis: number;
  /** 段階ごとのピッチ配列 (1段階目=step, 2段階目=step*2 ...) */
  pitches: number[];
}

/**
 * 全フックショットで共通のランタイム状態
 */
export interface BaseHookshotState<TId extends HookshotId = HookshotId> {
  hookshotId: TId;
  /** 発射時に選択していたホットバースロット番号 (0-8) */
  slotIndex?: number;
  anchor: AnchorPosition;
  /** 着弾面の法線ベクトル（外向き） */
  normal?: Vector3;
  currentLength: number;
  jumpConsumed?: boolean;
  sneakConsumed?: boolean;
  /** 空中ジャンプ入力によって現在短縮（巻き取り）中かどうか */
  isReelingIn?: boolean;
}

/**
 * 構え（未着弾・自動伸長）機能を持つフックショットの状態
 */
export interface AirProbingState {
  /** アンカー確定済みかどうか（省略時は true 扱い、false は未着弾の構え状態） */
  isAnchored?: boolean;
  /** 構え中の固定方向ベクトル（単位ベクトル） */
  probingDirection?: Vector3;
  /** 構え中の自動伸長が有効かどうか */
  isAutoExtending?: boolean;
  /** 自動ステップ伸長の直近実行Tick */
  lastAutoExtendTick?: number;
}

/**
 * 格納（縮める）アニメーション・クールダウン機能を持つフックショットの状態
 */
export interface RetractState {
  /** 格納（縮める）アニメーション・クールダウン中かどうか */
  isRetracting?: boolean;
  /** 格納時に維持する方向ベクトル（単位ベクトル） */
  retractDirection?: Vector3;
  /** 格納中の現在の長さ (blocks) */
  retractLength?: number;
  /** 格納のステップ実行／効果音再生の直近Tick */
  lastRetractTick?: number;
  /** 格納開始時点の太さ・密度スコア (0.0〜1.0, 格納中に太さが変化しないように保持) */
  retractThicknessScore?: number;
}

/**
 * ステップ伸縮機能を持つフックショットの状態
 */
export interface StepReelState {
  /** ステップ伸縮の直近実行Tick */
  lastStepReelTick?: number;
  /** ステップ伸縮の現在の待機間隔（Tick） */
  currentStepIntervalTicks?: number;
  /** 直近のステップ伸縮方向（方向転換時のリセット判定用） */
  lastStepMode?: ReelMode;
}

/**
 * 連続伸縮時の効果音間隔管理を持つフックショットの状態
 */
export interface ContinuousReelState {
  /** 連続伸縮時の効果音再生直近Tick */
  lastContinuousReelSoundTick?: number;
}

/**
 * 全フックショットで共通の定義プロパティ
 */
export interface BaseHookshotDefinition<
  TId extends HookshotId = HookshotId,
  TState extends BaseHookshotState<TId> = BaseHookshotState<TId>,
> {
  /** 一意な識別子 */
  id: TId;
  /** 使用するアイテムの typeId */
  itemTypeId: string;
  /** Raycast の最大射程距離 (blocks) */
  maxDistance: number;
  /** ロープ長の変更挙動設定（連続またはステップ） */
  reel: ReelConfig;
  /** 長さ変更の挙動モード ("shorten": 縮む, "extend": 伸びる) */
  reelMode: ReelMode;
  /** 最小ロープ長 (blocks) */
  minRopeLength: number;
  /** ワイヤーの描画スタイル（パーティクル、形状モードなど） */
  wireStyle: WireStyle;
  /** 発射時の効果音ID */
  shotSoundId: string;
  /** 毎Tickの物理インパルス計算 */
  calculateImpulse: (player: Player, state: TState) => Vector3;
}

/**
 * 未着弾構え・自動伸長機能の定義
 */
export interface AirProbingCapable {
  /** 未着弾構え・自動伸長の設定 */
  airProbing: AirProbingConfig;
}

/**
 * 解除時の格納アニメーション・クールダウン機能の定義
 */
export interface RetractCapable {
  /** 解除時の格納（縮める）アニメーション・クールダウン設定 */
  retract: RetractConfig;
}

/**
 * 発射時レイキャスト猶予・着弾/不発サウンド機能の定義
 */
export interface RaycastGraceCapable {
  /** 発射時にブロックへ当たらなかった場合、指定Tick数の間だけ視線方向へのレイキャスト探索を継続する */
  raycastGraceTicks: number;
  /** 着弾（アンカー確定）時の効果音ID */
  hitSoundId: string;
  /** 猶予探索（raycastGraceTicks）が着弾せず終了した時の効果音ID */
  missSoundId: string;
}

/**
 * 視線ステアリング推進力機能の定義
 */
export interface GazeSteeringCapable {
  /** 視線ステアリング推進力を有効にするかどうか */
  enableGazeSteering: boolean;
}

export type HookshotState =
  | BambooHookshotState
  | ElasticHookshotState
  | RigidHookshotState
  | RodHookshotState
  | SpringHookshotState;

export type HookshotDefinition =
  | BambooHookshotDefinition
  | ElasticHookshotDefinition
  | RigidHookshotDefinition
  | RodHookshotDefinition
  | SpringHookshotDefinition;
