import { Player, Vector3 } from "@minecraft/server";
import { WireStyle } from "../render/types";

export type HookshotId = string;

export type AnchorPosition = Vector3 & { dimensionId: string };

export type ReelMode = "shorten" | "extend";

export type ContinuousSoundConfig =
  | {
      /** 効果音ID */
      soundId: string;
      /** 効果音再生間隔 (ticks) */
      soundIntervalTicks: number;
    }
  | {
      soundId?: undefined;
      soundIntervalTicks?: undefined;
    };

export type ReelConfig =
  | ({
      mode: "continuous";
      /** 継続的な長さ変更速度 (blocks/tick, 単一数値または { shorten, extend } で指定可能) */
      speed: number | { shorten: number; extend: number };
      /** 距離が自然長以下（たるみ中）のときの短縮速度 (blocks/tick, 省略時は speed と同じ) */
      slackSpeed?: number;
      /** ボタンを押した瞬間に追加で一気に変更する瞬間変化量 (blocks, 単一数値または { shorten?, extend? } で指定可能) */
      initialDelta?: number | { shorten?: number; extend?: number };
    } & ContinuousSoundConfig)
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
  | ({
      mode: "continuous";
      /** 着弾までに自動で伸びる速度 (blocks/tick) */
      speed: number;
    } & ContinuousSoundConfig)
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
  /** 手元・足元の誤爆防止で除外する最小距離 (blocks) */
  minHitDistance: number;
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
 * 全フックショットで共通の最小限ランタイム状態
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
  /** 短縮（巻き取り）入力中かどうか */
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
 * HookshotSystem が定義側のライフサイクルフックへ提供する共通操作コンテキスト
 */
export interface HookshotContext {
  playSound: (player: Player, soundId?: string, pitch?: number) => void;
  unhook: (
    player: Player,
    options?: UnhookOptions,
  ) => void;
  consumeDurability: (
    player: Player,
    expectedItemTypeId: string,
    slotIndex?: number,
  ) => void;
  setActiveState: (player: Player, state: BaseHookshotState) => void;
  clearActiveState: (player: Player) => void;
}

export interface UnhookOptions {
  skipReleaseShot?: boolean;
  overrideSoundId?: string;
}

export interface ReelCapable {
  /** ロープ長の変更挙動設定（連続またはステップ） */
  reel: ReelConfig;
  /** 長さ変更の挙動モード ("shorten": 縮む, "extend": 伸びる) */
  reelMode: ReelMode;
  /** 最小ロープ長 (blocks) */
  minRopeLength: number;
  /** 着弾中の実距離とロープ長の差による伸縮制限 (blocks) */
  reelLengthDiffLimit?: {
    /** 実距離がロープ長よりこの値以上長いとき、短縮（巻き取り）を停止する */
    outward?: number;
    /** ロープ長が実距離よりこの値以上長いとき、伸長を停止する */
    inward?: number;
  };
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

/**
 * 全フックショットで共通の最小限定義プロパティ＋ライフサイクルフック
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
  /** 剛体・限界長拘束における Baumgarte 位置誤差安定化係数 */
  baumgarteFactor?: number;
  /** ワイヤーの描画スタイル（パーティクル、形状モードなど） */
  wireStyle: WireStyle;
  /** 発射時の効果音ID */
  shotSoundId: string;
  /** 解除時の効果音ID */
  detachSoundId?: string;
  /** 解除時に耐久値を消費するかどうか（デフォルト: true） */
  consumeDurabilityOnDetach?: boolean;
  /** 毎Tickの物理インパルス計算 */
  calculateImpulse: (player: Player, state: TState) => Vector3;

  // --- ライフサイクルフック（個別仕様の移譲先） ---
  /** 標準のレイキャスト発射を置き換えるカスタム発射処理 */
  customShot?: (player: Player, ctx: HookshotContext) => boolean;
  /** 既に同じフックショットが接続中のときに再使用された場合のフック（true を返すと標準トグル解除をスキップ） */
  onToggleWhileActive?: (
    player: Player,
    state: TState,
    ctx: HookshotContext,
  ) => boolean;
  /** 初期状態の追加初期化フック */
  onCreateState?: (player: Player, state: TState) => void;
  /** アンカー確定（着弾）時のフック */
  onAttach?: (
    player: Player,
    state: TState,
    info: { initialDirection: Vector3; distance: number },
    ctx: HookshotContext,
  ) => void;
  /** 解除処理の開始直前（耐久消費や格納アニメーション前）のフック */
  onBeforeDetach?: (
    player: Player,
    state: TState,
    options: UnhookOptions | undefined,
    ctx: HookshotContext,
  ) => void;
  /** 解除時のクリーンアップフック */
  onDetach?: (player: Player, state: TState, ctx: HookshotContext) => void;
  /** 標準の入力伸縮処理を許可するかどうかの判定 */
  canHandleReelInput?: (player: Player, state: TState) => boolean;
  /** チャージ＆リリース型（両押し/シフト押下で isReelingIn を維持）かどうか */
  hasChargeRelease?: boolean;
  /** 短縮・伸長入力が固有条件でブロックされているかの判定 */
  isReelBlocked?: (
    player: Player,
    state: TState,
    mode: ReelMode,
    ctx: HookshotContext,
  ) => boolean;
  /** 連続伸縮時の基本速度を補正するフック */
  modifyReelSpeed?: (
    player: Player,
    state: TState,
    mode: ReelMode,
    baseSpeed: number,
    isInitial: boolean,
  ) => number;
  /** 長さ変更のカスタム適用フック（返り値で変更有無と強制保存を指定） */
  customApplyLengthDelta?: (
    player: Player,
    state: TState,
    mode: ReelMode,
    delta: number,
    forceSave: boolean,
    soundId: string | undefined,
    ctx: HookshotContext,
  ) => boolean;
  /** 長さ変更が適用された後のフック */
  onLengthChanged?: (
    player: Player,
    state: TState,
    mode: ReelMode,
    prevLength: number,
    nextLength: number,
  ) => void;
  /** 毎Tick更新フック（アンカー確定・未確定を問わず、入力処理の後に呼ばれる。false を返すとそのTickの残り処理をスキップ） */
  onTick?: (
    player: Player,
    state: TState,
    info: { activeReelMode: ReelMode | null; wasReelingIn: boolean },
    ctx: HookshotContext,
  ) => boolean | void;
  /** 過伸長などによる自動解除判定フック */
  shouldDetach?: (
    player: Player,
    state: TState,
    distance: number,
  ) => { detach: true; options?: UnhookOptions } | { detach: false };
  /** 物理インパルス適用後のフック */
  onImpulseApplied?: (
    player: Player,
    state: TState,
    impulse: Vector3,
    ctx: HookshotContext,
  ) => void;
  /** カスタム描画フック（未指定時は HookRenderManager.renderHookshot を使用） */
  render?: (player: Player, state: TState) => void;
  /** 標準描画時に渡すワイヤー軸解決フック */
  getWireAxis?: (state: TState) => Vector3 | undefined;
  /** 標準描画時に渡す追加チャージ量取得フック */
  getRenderExtraCharge?: (state: TState) => number | undefined;
  /** アクションバーHUDの距離・状態テキスト整形フック */
  formatHudText?: (player: Player, state: TState, distance: number) => string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HookshotState = BaseHookshotState<any>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HookshotDefinition = BaseHookshotDefinition<string, any> &
  Partial<
    ReelCapable & AirProbingCapable & RetractCapable & RaycastGraceCapable
  >;
