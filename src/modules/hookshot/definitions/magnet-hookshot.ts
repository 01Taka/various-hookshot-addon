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
  /** 今Tickがモード開始瞬間（初速／爆発バースト適用Tick）かどうか */
  isModeEntryTick?: boolean;
  /** 一度でも引き寄せまたは反発を実行したかどうか */
  hasActivatedForce?: boolean;
  /** 引き寄せ吸着ロック中かどうか（カチッ音の一回再生判定用） */
  isAttractLocked?: boolean;
  /** 動作音再生の直近Tick */
  lastActiveSoundTick?: number;
  /** 反発初回バーストの直近発動Tick */
  lastRepelBurstTick?: number;
}

export interface MagnetHookshotDefinition
  extends BaseHookshotDefinition<
    typeof MAGNET_HOOKSHOT_ID,
    MagnetHookshotState
  > {
  /** 着弾（磁化成功）時の効果音ID */
  hitSoundId: string;
  /** 不発（空撃ち）時の効果音ID */
  missSoundId: string;
  /** 解除時の効果音ID */
  detachSoundId: string;
  /** 吸着ロック時の効果音ID */
  lockSoundId: string;
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
  lockSoundId: "random.click",
  activeSound: {
    soundId: "beacon.ambient",
    intervalTicks: 10,
  },
  physics: {
    fullEffectDistance: 50,
    zeroEffectDistance: 80,
    attractInitialSpeed: 1.6,
    attractAccel: 0.2,
    attractMaxSpeed: 4.0,
    attractLockRadius: 1.2,
    attractBrakeTicks: 3.0,
    attractBrakeMinSpeed: 0.2,
    repelBurstSpeed: 3.6,
    repelSustainAccel: 0.2,
    repelRefDistance: 10.0,
    repelBurstCooldownTicks: 10,
  },
  calculateImpulse: (player, state): Vector3 => {
    return calculateMagnetHookshot(
      player,
      state.anchor,
      state.activeMode,
      !!state.isModeEntryTick,
      magnetHookshotDefinition.physics,
    );
  },
};
