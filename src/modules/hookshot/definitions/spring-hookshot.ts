import { SPRING_WIRE_STYLE } from "../../render";
import { calculateSpringHookshot } from "../math/spring-math";
import { HookshotDefinition } from "../types";

export const SPRING_HOOKSHOT_ID = "spring";
export const SLIME_BALL_ITEM_ID = "minecraft:slime_ball";

/**
 * バネの曲げ復元力（角度維持）の基準モード
 * - "shot_angle": 刺さった瞬間の角度・方向を維持（新仕様）
 * - "surface_normal": 着弾面の法線方向（垂直）を維持（従来の仕様）
 */
export type SpringBendingMode = "shot_angle" | "surface_normal";

/**
 * スライムバネの設定
 * bendingMode を "surface_normal" に変更することで従来の面法線維持仕様へ簡単に切り替え可能です。
 */
export interface SpringHookshotConfig {
  /** 曲げ復元力の基準モード ("shot_angle" | "surface_normal") */
  bendingMode: SpringBendingMode;
}

export const springHookshotConfig: SpringHookshotConfig = {
  bendingMode: "shot_angle",
};

/**
 * 現在の設定に応じた曲げ基準軸（角度維持ベクトル）を取得します
 */
export function getSpringBendingAxis(
  state: Parameters<HookshotDefinition["calculateImpulse"]>[1],
) {
  return springHookshotConfig.bendingMode === "shot_angle"
    ? (state.initialDirection ?? state.normal)
    : state.normal;
}

/**
 * スライムボール（minecraft:slime_ball）を使用した双方向バネフックショットの定義
 * 空中ジャンプ入力で短く（shorten）、シフト入力で長く（extend）
 */
export const springHookshotDefinition: HookshotDefinition = {
  id: SPRING_HOOKSHOT_ID,
  itemTypeId: SLIME_BALL_ITEM_ID,
  maxDistance: 48,
  reelSpeed: 1.0,
  reelMode: "extend",
  initialReelDelta: 3.0,
  minRopeLength: 0.5,
  wireStyle: SPRING_WIRE_STYLE,
  getWireAxis: (state) => getSpringBendingAxis(state),
  calculateImpulse: (player, state) => {
    // 設定された bendingMode に応じた基準軸を選択
    const bendingAxis = getSpringBendingAxis(state);

    return calculateSpringHookshot(player, state.anchor, {
      naturalLength: state.currentLength,
      maxLength: Math.max(200, state.currentLength * 1.5),
      stiffness: 0.03,
      damping: 0.01,
      surfaceNormal: state.normal,
      bendingAxis,
      bendingStiffness: 0.01,
      bendingDamping: 0.02,
    });
  },
};
