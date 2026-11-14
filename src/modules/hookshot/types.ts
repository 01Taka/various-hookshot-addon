import { Player, Vector3 } from "@minecraft/server";
import { WireStyle } from "../render/types";

export type AnchorPosition = Vector3 & { dimensionId: string };

export interface HookshotState {
  hookshotId: string;
  /** 発射時に選択していたホットバースロット番号 (0-8) */
  slotIndex?: number;
  anchor: AnchorPosition;
  /** アンカー確定済みかどうか（省略時は true 扱い、false は未着弾の構え状態） */
  isAnchored?: boolean;
  /** 構え中の固定方向ベクトル（単位ベクトル） */
  probingDirection?: Vector3;
  /** 構え中の自動伸長が有効かどうか */
  isAutoExtending?: boolean;
  /** 自動ステップ伸長の直近実行Tick */
  lastAutoExtendTick?: number;
  /** 格納（縮める）アニメーション・クールダウン中かどうか */
  isRetracting?: boolean;
  /** 格納時に維持する方向ベクトル（単位ベクトル） */
  retractDirection?: Vector3;
  /** 格納中の現在の長さ (blocks) */
  retractLength?: number;
  /** 格納のステップ実行／効果音再生の直近Tick */
  lastRetractTick?: number;
  /** 着弾面の法線ベクトル（外向き） */
  normal?: Vector3;
  /** アンカーからプレイヤーへ向かう、フック着弾（刺さった）瞬間の初期方向ベクトル（単位ベクトル） */
  initialDirection?: Vector3;
  currentLength: number;
  /** 最小ロープ長到達後に蓄積された追加チャージ量 (blocks, 0〜maxExtraCharge) */
  extraCharge?: number;
  jumpConsumed?: boolean;
  sneakConsumed?: boolean;
  /** 空中ジャンプ入力によって現在短縮（巻き取り）中かどうか */
  isReelingIn?: boolean;
  /** チャージ解放による放物線射出モード中かどうか */
  isChargeReleasing?: boolean;
  /** リリース直後の初速インパルスを未適用かどうか */
  releaseShotPending?: boolean;
  /** リリース開始Tick */
  releaseStartTick?: number;
  /** 放物線射出中の前Tickにおけるアンカーとの距離 */
  lastReleaseDistance?: number;
  /** 放物線射出中に接近速度が閾値を下回った連続Tick数 */
  releaseStallTicks?: number;
  /** 前Tickのチャージ伸び量（マイルストーン効果音判定用） */
  prevChargeStretch?: number;
  /** 直近に鳴らしたチャージマイルストーン距離 (m) */
  lastChargeSoundThreshold?: number;
  /** 直近のマイルストーンから±hysteresis以上離れて再鳴動可能になったか */
  canRetriggerLastThreshold?: boolean;
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
  /** 最小ロープ長到達後に追加で蓄積できる仮想チャージ上限 (blocks, デフォルト: 0) */
  maxExtraCharge?: number;
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
  /** 解除時の格納（縮める）アニメーション・クールダウン設定 */
  retract?: RetractConfig;
  /** 発射時にブロックへ当たらなかった場合、指定Tick数の間だけ視線方向へのレイキャスト探索を継続する */
  raycastGraceTicks?: number;
  /** 最大長まで伸ばしきった状態で、伸ばすボタン押下中に自然長を超えた（最高速度到達）時に自動解除するか */
  detachOnMaxExtend?: boolean;
  /** 自然長を超えて指定距離 (blocks) 以上伸びた場合に自動でアンカーを解除する */
  detachOnOverstretch?: number;
  /** 自動解除時の効果音ID */
  detachSoundId?: string;
  /** 巻き取り終了（チャージ解放）時の効果音ID */
  releaseSoundId?: string;
  /** 巻き取り終了時に発射を有効とする最小の伸び量 (blocks)。これ以下の場合は現在距離を自然長にリセットして発射を無効化する */
  minReleaseStretch?: number;
  /** チャージ中の伸び量マイルストーン効果音設定 */
  chargeMilestoneSound?: ChargeMilestoneSoundConfig;
  /** 発射時の効果音ID */
  shotSoundId?: string;
  /** 着弾（アンカー確定）時の効果音ID */
  hitSoundId?: string;
  /** 猶予探索（raycastGraceTicks）が着弾せず終了した時の効果音ID */
  missSoundId?: string;
  /** 接続中アクションバーの表示文字列をカスタマイズするコールバック */
  formatDistanceUi?: (
    player: Player,
    state: HookshotState,
    distance: number,
  ) => string;
  /** 毎Tickの物理インパルス計算 */
  calculateImpulse: (player: Player, state: HookshotState) => Vector3;
  /** フック接続時のコールバック (演出など任意) */
  onAttach?: (player: Player, state: HookshotState) => void;
  /** フック解除時のコールバック (演出など任意) */
  onDetach?: (player: Player, state: HookshotState) => void;
}

