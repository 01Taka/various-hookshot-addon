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
}

export type ReelMode = "shorten" | "extend";

export interface StepReelConfig {
  /** 1ステップあたりの長さ変化量 (blocks) */
  stepLength: number;
  /** 初回長押し間隔 (ticks) */
  initialIntervalTicks: number;
  /** 最小間隔 (ticks) */
  minIntervalTicks: number;
  /** 1ステップごとに短縮するTick数 */
  intervalDecayTicks: number;
}

export interface HookshotDefinition {
  /** 一意な識別子 (例: "elastic", "rigid", "rod", "spring") */
  id: string;
  /** 使用するアイテムの typeId (例: "minecraft:lead", "minecraft:string") */
  itemTypeId: string;
  /** Raycast の最大射程距離 (blocks, デフォルト: 1200) */
  maxDistance?: number;
  /** ジャンプ/シフト入力時の継続的な長さ変更速度 (blocks/tick, デフォルト: 1.25) */
  reelSpeed?: number;
  /** ボタンを押した瞬間に追加で一気に変更する瞬間変化量 (blocks, 単一数値または { shorten?, extend? } で指定可能。デフォルト: 0) */
  initialReelDelta?: number | { shorten?: number; extend?: number };
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
  /** 未着弾でも構え状態（平行移動）として発射できるか */
  allowAirProbing?: boolean;
  /** 構え状態の初期長 (blocks, デフォルト: 12) */
  probingInitialLength?: number;
  /** 構え中のブロック接触判定で除外する手元最小距離 (blocks, デフォルト: 1.5) */
  probingMinHitDistance?: number;
  /** ステップ式伸縮設定（指定時は連続reelSpeedではなくステップ伸縮を使用） */
  stepReel?: StepReelConfig;
  /** ステップ伸縮時の効果音ID */
  stepSoundId?: string;
  /** 構えからブロックに刺さった時の効果音ID */
  probingHitSoundId?: string;
  /** 毎Tickの物理インパルス計算 */
  calculateImpulse: (player: Player, state: HookshotState) => Vector3;
  /** フック接続時のコールバック (演出など任意) */
  onAttach?: (player: Player, state: HookshotState) => void;
  /** フック解除時のコールバック (演出など任意) */
  onDetach?: (player: Player, state: HookshotState) => void;
}

