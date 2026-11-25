import { Vector3 } from "@minecraft/server";
import { MAGNET_GUIDE_WIRE_STYLE } from "../../render";
import {
  calculateMagnetHookshot,
  MagnetForceMode,
  MagnetPhysicsConfig,
} from "../math/magnet-math";
import { BaseHookshotDefinition, BaseHookshotState } from "../types";

export const MAGNET_HOOKSHOT_ID = "magnet";
export const MAGNET_ITEM_ID = "various_hookshot_addon:magnet_hookshot";

export interface MagnetHookshotState
  extends BaseHookshotState<typeof MAGNET_HOOKSHOT_ID> {
  /** 磁化されているブロックの整数座標 */
  blockPos: Vector3;
  /** 現在発動中の磁力モード ("none" / "attract"=Jump / "repel"=Shift) */
  activeMode: MagnetForceMode;
  /** 動作音再生の直近Tick */
  lastActiveSoundTick?: number;
}

export interface MagnetHookshotDefinition
  extends BaseHookshotDefinition<
    typeof MAGNET_HOOKSHOT_ID,
    MagnetHookshotState
  > {
  /** 磁化ブロックから自動消滅する離脱距離 (blocks) */
  maxDetachDistance: number;
  /** 着弾（磁化成功）時の効果音ID */
  hitSoundId: string;
  /** 不発（空撃ち）時の効果音ID */
  missSoundId: string;
  /** 解除時の効果音ID */
  detachSoundId: string;
  /** 磁力稼働中のループ効果音設定 */
  activeSound: {
    soundId: string;
    intervalTicks: number;
  };
  /** 物理パラメータ */
  physics: MagnetPhysicsConfig;
}

export const magnetHookshotDefinition: MagnetHookshotDefinition = {
  id: MAGNET_HOOKSHOT_ID,
  itemTypeId: MAGNET_ITEM_ID,
  maxDistance: 100,
  maxDetachDistance: 200,
  reel: {
    mode: "continuous",
    speed: 0,
  },
  reelMode: "shorten",
  minRopeLength: 0,
  wireStyle: MAGNET_GUIDE_WIRE_STYLE,
  shotSoundId: "crossbow.shoot",
  hitSoundId: "block.lodestone.place",
  missSoundId: "note.bass",
  detachSoundId: "beacon.deactivate",
  activeSound: {
    soundId: "beacon.ambient",
    intervalTicks: 10,
  },
  physics: {
    maxAccel: 0.14,
    fullStrengthDistance: 30,
    zeroDistance: 100,
  },
  calculateImpulse: (player, state): Vector3 => {
    return calculateMagnetHookshot(
      player,
      state.anchor,
      state.activeMode,
      magnetHookshotDefinition.physics,
    );
  },
};
