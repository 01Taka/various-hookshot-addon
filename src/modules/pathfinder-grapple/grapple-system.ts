import { Vector3Utils } from "@minecraft/math";
import {
  ButtonState,
  InputButton,
  Player,
  system,
  world,
} from "@minecraft/server";
import {
  calculateVelocityImpulse,
  isSneakButtonPressed,
  MINECRAFT_DRAG,
  MINECRAFT_GRAVITY,
  PlayerDirectionResolver,
  PlayerStateManager,
} from "addon-utils";
import { HookshotSystem } from "../hookshot/hookshot-system";
import {
  calculatePathfinderVelocityImpulse,
  calculatePostFlightImpulse,
  getPlayerChestLocation,
  playSoundSafe,
} from "./physics";
import {
  PathfinderActiveState,
  PathfinderAnchor,
  PathfinderPostFlightState,
} from "./types";

export const PATHFINDER_ITEM_ID = "minecraft:iron_ingot";
export const PATHFINDER_MAX_DISTANCE = 72;

const PATHFINDER_ACTIVE_KEY = "pathfinderActiveState";
const PATHFINDER_POST_FLIGHT_KEY = "pathfinderPostFlightState";
const PATHFINDER_LAST_USE_TICK_KEY = "pathfinderLastUseTick";
const PATHFINDER_LAST_JUMP_TICK_KEY = "pathfinderLastJumpTick";

/** アンカー到達とみなして自動切断する距離 (blocks) */
const ARRIVAL_DISTANCE = 2.3;
/** 最大接続継続時間 (ticks = 5.0秒) */
const MAX_GRAPPLE_TICKS = 100;
/** 発射直後の角度切断免除時間 (ticks) */
const ANGLE_GRACE_TICKS = 6;
/** 90度ルール自動切断の cos 閾値 (cos(98°) ≈ -0.14) */
const DETACH_COS_THRESHOLD = -0.14;

export class PathfinderGrappleSystem {
  private static isInitialized = false;

  public static getActiveState(player: Player): PathfinderActiveState | null {
    return PlayerStateManager.get<PathfinderActiveState | null>(
      player.id,
      PATHFINDER_ACTIVE_KEY,
      null,
    );
  }

  public static getLastJumpPressTick(player: Player): number {
    return PlayerStateManager.get<number>(
      player.id,
      PATHFINDER_LAST_JUMP_TICK_KEY,
      -9999,
    );
  }

  /**
   * グラップルを発射・接続します。
   */
  public static shot(player: Player): boolean {
    const hit = player.getBlockFromViewDirection({
      maxDistance: PATHFINDER_MAX_DISTANCE,
      includeLiquidBlocks: false,
      includePassableBlocks: false,
    });

    if (!hit) {
      playSoundSafe(player, "note.hat", 0.5, 0.6);
      try {
        player.onScreenDisplay.setActionBar("§7✖ グラップル射程外");
      } catch {}
      return false;
    }

    // メインの通常フックショットが接続中なら自動解除（排他連携）
    HookshotSystem.unhook(player);

    // 既存の慣性飛行状態をクリア
    PlayerStateManager.delete(player.id, PATHFINDER_POST_FLIGHT_KEY);

    const anchor: PathfinderAnchor = {
      dimensionId: player.dimension.id,
      x: hit.block.x + 0.5,
      y: hit.block.y + 0.5,
      z: hit.block.z + 0.5,
    };

    const chest = getPlayerChestLocation(player);
    const diff = Vector3Utils.subtract(anchor, chest);
    const dist = Vector3Utils.magnitude(diff);

    const onGround = player.isOnGround;
    const state: PathfinderActiveState = {
      anchor,
      attachedTick: system.currentTick,
      minReachedDistance: dist,
      hasGrappleJumped: false,
      wasAirborne: !onGround,
      startedOnGround: onGround,
      detachReason: "manual",
    };

    PlayerStateManager.set(player.id, PATHFINDER_ACTIVE_KEY, state);
    playSoundSafe(player, "random.bowhit", 0.9, 1.35);

    // 地上で発射した場合、初期地面摩擦への引っかかりを防ぐ初動リフト
    const toAnchorDir = Vector3Utils.scale(diff, 1 / Math.max(0.0001, dist));
    if (onGround && toAnchorDir.y > -0.25) {
      player.applyImpulse({ x: 0, y: 0.22, z: 0 });
    }

    return true;
  }

  /**
   * グラップルを切断・解除します。
   */
  public static unhook(player: Player): void {
    const state = this.getActiveState(player);
    if (!state) return;

    PlayerStateManager.delete(player.id, PATHFINDER_ACTIVE_KEY);
    playSoundSafe(player, "random.bow", 0.8, 1.55);

    const reason = state.detachReason;
    const currentVel = player.getVelocity();

    // 近接到達で切れた場合は、崖や屋根の上に綺麗に降りられるよう軽く乗り上げる
    if (reason === "arrival") {
      if (state.anchor.y >= player.location.y - 0.5) {
        const mantleImpulse = calculateVelocityImpulse({
          targetVelocity: {
            x: currentVel.x * 0.35,
            y: Math.max(currentVel.y * 0.4, 0.38),
            z: currentVel.z * 0.35,
          },
          currentVelocity: currentVel,
          dragXZ: MINECRAFT_DRAG.air.xz,
          dragY: MINECRAFT_DRAG.air.y,
          gravity: MINECRAFT_GRAVITY,
        });
        player.applyImpulse(mantleImpulse);
      }
      return;
    }

    // 空中ジャンプ解除時はわずかな上向きポップを付与
    if (reason === "jump" && currentVel.y < 0.45) {
      player.applyImpulse({ x: 0, y: 0.14, z: 0 });
    }

    // 空中でスリングショット切断された場合、着地まで低空気抵抗の放物線慣性飛行へ移行
    if (!player.isOnGround && !player.isFlying) {
      const postFlight: PathfinderPostFlightState = {
        detachedTick: system.currentTick,
        lastProcessedTick: system.currentTick,
      };
      PlayerStateManager.set(player.id, PATHFINDER_POST_FLIGHT_KEY, postFlight);
    }
  }

  /**
   * トグル操作
   */
  public static toggle(player: Player): void {
    if (this.getActiveState(player)) {
      this.unhook(player);
    } else {
      this.shot(player);
    }
  }

  /**
   * 毎Tickの自動切断判定
   */
  private static checkAutoDetach(
    player: Player,
    state: PathfinderActiveState,
  ): boolean {
    const ticksElapsed = system.currentTick - state.attachedTick;
    if (!player.isOnGround && ticksElapsed >= 3) {
      state.wasAirborne = true;
    }

    const chest = getPlayerChestLocation(player);
    const diff = Vector3Utils.subtract(state.anchor, chest);
    const dist = Vector3Utils.magnitude(diff);

    // 1. アンカー近接到達
    if (dist < ARRIVAL_DISTANCE) {
      state.detachReason = "arrival";
      return true;
    }

    // 2. 最大継続時間の超過
    if (ticksElapsed > MAX_GRAPPLE_TICKS) {
      state.detachReason = "timeout";
      return true;
    }

    // 3. スニーク（しゃがみ）による任意即時キャンセル
    if (ticksElapsed >= 2 && isSneakButtonPressed(player)) {
      state.detachReason = "crouch";
      return true;
    }

    // 4. 空中スイング中のジャンプ再入力による任意切断
    const lastJumpTick = this.getLastJumpPressTick(player);
    if (
      ticksElapsed >= 8 &&
      !player.isOnGround &&
      !player.isFlying &&
      (state.hasGrappleJumped || !state.startedOnGround) &&
      lastJumpTick === system.currentTick
    ) {
      state.detachReason = "jump";
      return true;
    }

    // 5. 空中スイング後の着地による自動切断
    if (ticksElapsed > 12 && state.wasAirborne && player.isOnGround) {
      state.detachReason = "ground";
      return true;
    }

    // 6. 90度ルール（アンカーが視界の横〜後方へ外れた瞬間）
    if (ticksElapsed >= ANGLE_GRACE_TICKS && dist > 0.0001) {
      const toAnchorDir = Vector3Utils.scale(diff, 1 / dist);
      const lookDir = PlayerDirectionResolver.get(player).view.vector;
      const cosTheta = Vector3Utils.dot(toAnchorDir, lookDir);
      if (cosTheta < DETACH_COS_THRESHOLD) {
        state.detachReason = "angle";
        return true;
      }
    }

    return false;
  }

  /**
   * パスファインダーグラップルの初期化
   */
  public static init(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // メインのフックショットが発射された時に、パスファインダー側を自動解除するハンドラを登録
    HookshotSystem.registerExternalUnhookHandler((player) => {
      this.unhook(player);
    });

    const handleUse = (player: Player, itemTypeId?: string) => {
      if (itemTypeId !== PATHFINDER_ITEM_ID) return;

      const lastTick = PlayerStateManager.get<number | null>(
        player.id,
        PATHFINDER_LAST_USE_TICK_KEY,
        null,
      );
      if (lastTick === system.currentTick) return;
      PlayerStateManager.set(
        player.id,
        PATHFINDER_LAST_USE_TICK_KEY,
        system.currentTick,
      );

      this.toggle(player);
    };

    // 右クリック（空中・ブロック）
    world.afterEvents.itemUse.subscribe((event) => {
      handleUse(event.source, event.itemStack?.typeId);
    });
    world.afterEvents.itemStartUseOn.subscribe((event) => {
      handleUse(event.source, event.itemStack?.typeId);
    });

    // ジャンプ押下エッジの記録（グラップルジャンプ先行入力および空中切断用）
    world.afterEvents.playerButtonInput.subscribe((event) => {
      if (
        event.button === InputButton.Jump &&
        event.newButtonState === ButtonState.Pressed
      ) {
        PlayerStateManager.set(
          event.player.id,
          PATHFINDER_LAST_JUMP_TICK_KEY,
          system.currentTick,
        );
      }
    });

    // 毎Tickのグラップル牽引・自動切断・事後慣性飛行ループ
    system.runInterval(() => {
      for (const player of world.getAllPlayers()) {
        if (!player.isValid) continue;

        const state = this.getActiveState(player);
        if (state) {
          // ディメンション変化時の解除
          if (player.dimension.id !== state.anchor.dimensionId) {
            this.unhook(player);
            continue;
          }

          // 自動切断判定
          if (this.checkAutoDetach(player, state)) {
            this.unhook(player);
            continue;
          }

          // 物理インパルスの適用
          const impulse = calculatePathfinderVelocityImpulse(
            player,
            state,
            this.getLastJumpPressTick(player),
          );
          if (impulse.x !== 0 || impulse.y !== 0 || impulse.z !== 0) {
            player.applyImpulse(impulse);
          }
          continue;
        }

        // 未接続時の放物線慣性飛行（スリングショット後の滑空維持）
        const postFlight =
          PlayerStateManager.get<PathfinderPostFlightState | null>(
            player.id,
            PATHFINDER_POST_FLIGHT_KEY,
            null,
          );
        if (postFlight) {
          const impulse = calculatePostFlightImpulse(player, postFlight);
          if (impulse) {
            PlayerStateManager.set(
              player.id,
              PATHFINDER_POST_FLIGHT_KEY,
              postFlight,
            );
            if (impulse.x !== 0 || impulse.y !== 0 || impulse.z !== 0) {
              player.applyImpulse(impulse);
            }
          } else {
            PlayerStateManager.delete(player.id, PATHFINDER_POST_FLIGHT_KEY);
          }
        }
      }
    });
  }
}
