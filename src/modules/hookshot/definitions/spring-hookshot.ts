import { SPRING_WIRE_STYLE } from "../../render";
import { calculateSpringHookshot } from "../math/spring-math";
import { HookshotDefinition } from "../types";

export const SPRING_HOOKSHOT_ID = "spring";
export const SLIME_BALL_ITEM_ID = "minecraft:slime_ball";

/**
 * スライムボール（minecraft:slime_ball）を使用した双方向バネフックショットの定義
 * 空中ジャンプ入力でバネが伸びる（extend）
 */
export const springHookshotDefinition: HookshotDefinition = {
  id: SPRING_HOOKSHOT_ID,
  itemTypeId: SLIME_BALL_ITEM_ID,
  maxDistance: 60,
  reelSpeed: 1.5,
  reelMode: "extend",
  minRopeLength: 0.5,
  wireStyle: SPRING_WIRE_STYLE,
  calculateImpulse: (player, state) => {
    return calculateSpringHookshot(player, state.anchor, {
      naturalLength: state.currentLength,
      maxLength: Math.max(200, state.currentLength * 1.5),
      stiffness: 0.03,
      damping: 0.01,
    });
  },
};
