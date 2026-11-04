import { calculateSpringHookshot } from "../math/spring-math";
import { HookshotDefinition } from "../types";

export const SPRING_HOOKSHOT_ID = "spring";
export const SLIME_BALL_ITEM_ID = "minecraft:slime_ball";

/**
 * スライムボール（minecraft:slime_ball）を使用した双方向バネフックショットの定義
 */
export const springHookshotDefinition: HookshotDefinition = {
  id: SPRING_HOOKSHOT_ID,
  itemTypeId: SLIME_BALL_ITEM_ID,
  maxDistance: 1200,
  reelSpeed: 1.25,
  minRopeLength: 1.5,
  calculateImpulse: (player, state) => {
    return calculateSpringHookshot(player, state.anchor, {
      naturalLength: state.currentLength,
      maxLength: Math.max(200, state.currentLength * 1.5),
      stiffness: 0.03,
      damping: 0.01,
    });
  },
};
