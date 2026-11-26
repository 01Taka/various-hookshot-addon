import { Vector3 } from "@minecraft/server";
import { RigidSteeringConfig } from "../math/steering-math";
import {
  BaseHookshotDefinition,
  BaseHookshotState,
  ContinuousReelState,
  GazeSteeringCapable,
  RaycastGraceCapable,
  ReelCapable,
} from "../types";

export const RIGID_HOOKSHOT_ID = "rigid";

export interface RigidPhysicsConfig {
  /** ロープが張っているとみなす自然長からの許容マージン (blocks) */
  tautMargin: number;
  /** 内側スイング継続ゾーンの幅 (blocks) */
  innerSwingMargin: number;
  /** 内側スイング継続ゾーンでの緩やかな復元係数 */
  innerBaumgarteFactor: number;
  /** 内側スイング継続ゾーンから自由落下へ抜ける内向き速度閾値 (blocks/tick) */
  inwardEscapeThreshold: number;
  /** ステアリング加速時の最高速度上限（エアロベスト装着時, blocks/tick） */
  maxSteeringSpeed: number;
  /** ステアリング加速時の最高速度上限（エアロベスト未装着時, blocks/tick） */
  maxSteeringSpeedNormal?: number;
  /** エアロベスト装着かつ巻き取り中の重力倍率 (0.0〜1.0, 例: 0.8 = 20%軽減) */
  reelGravityScaleVest?: number;
  /** 非巻き取り時の振り子スイング追加加速度（通常時, blocks/tick²） */
  swingPumpAccelNormal: number;
  /** 非巻き取り時の振り子スイング追加加速度（エアロベスト装備時, blocks/tick²） */
  swingPumpAccelVest: number;
}

export interface RigidHookshotOptions {
  /** 空中ジャンプ入力によって現在短縮（巻き取り）中かどうか */
  isReelingIn?: boolean;
  /** 視線ステアリング推進力を有効にするかどうか */
  enableSteering?: boolean;
  /** エアロベスト系装備が有効かどうか（trueでフル旋回＋巻き取り中重力軽減） */
  hasAeroVest?: boolean;
  /** アンカーより上に滞在した累計Tick数 */
  aboveAnchorTicks?: number;
  /** Baumgarte 位置誤差安定化係数 */
  baumgarteFactor: number;
  /** 剛体ロープ物理パラメータ */
  physics: RigidPhysicsConfig;
  /** 視線ステアリングパラメータ */
  steering: RigidSteeringConfig;
  /** 非巻き取り時の振り子スイング追加加速度 (blocks/tick²) */
  swingPumpAccel: number;
  /** 指定時、振り子スイング加速からこの水平ベクトルと平行な成分を除去する */
  suppressPumpParallelDir?: Vector3;
}


export interface RigidHookshotState
  extends BaseHookshotState<typeof RIGID_HOOKSHOT_ID>,
    ContinuousReelState {
  /** 着弾直後の自動巻き取り残りTick数 */
  autoTakeUpRemainingTicks?: number;
  /** 巻き取り中に速度低下で停止している連続Tick数 */
  stallReelTicks?: number;
  /** アンカーより上に滞在して蓄積した減衰Tick数（アンカーより下で待機後に徐々に回復） */
  aboveAnchorTicks?: number;
  /** アンカーより下に連続滞在しているTick数（回復待機カウント用） */
  belowAnchorTicks?: number;
}

export interface RigidHookshotDefinition
  extends BaseHookshotDefinition<typeof RIGID_HOOKSHOT_ID, RigidHookshotState>,
    ReelCapable,
    RaycastGraceCapable,
    GazeSteeringCapable {
  /** 着弾直後にワイヤーが短い間だけ行う高速自動巻き取り設定 */
  autoTakeUp: {
    /** 自動巻き取りを行う最大Tick数 */
    ticks: number;
    /** 1Tickあたりの最大短縮速度 (blocks/tick) */
    speed: number;
  };
  /** 巻き取り中にプレイヤーがほとんど停止した場合の戻し・停止設定 */
  stallReelStop: {
    /** 停止とみなす速度閾値 (blocks/tick) */
    maxSpeed: number;
    /** 停止判定が成立する連続Tick数 */
    ticks: number;
    /** 停止時にチェーン長を戻す基準の距離差 (blocks) */
    restoreDiff: number;
  };
  /** 剛体ロープの物理パラメータ */
  physics: RigidPhysicsConfig;
  /** 視線ステアリング・振り子スイングパラメータ */
  steering: RigidSteeringConfig;
}