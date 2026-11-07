import { Player, system, Vector3, world } from "@minecraft/server";
import {
  calculateVelocityImpulse,
  MINECRAFT_DRAG,
  MINECRAFT_GRAVITY,
  PlayerDirectionResolver,
  PlayerStateManager,
} from "addon-utils";
import { PostFlightOptions, PostFlightState } from "./types";

export const POST_FLIGHT_STATE_KEY = "hookshotPostFlightState";

export const DEFAULT_POST_FLIGHT_OPTIONS: Required<PostFlightOptions> = {
  maxTicks: 100,
  retentionXZ: 0.992,
  minStartSpeed: 0.2,
  minMaintainSpeed: 0.25,
  enableAirStrafe: true,
  airWishSpeed: 0.3,
  airAccel: 0.035,
};

export class PostFlightSystem {
  private static isInitialized = false;

  /**
   * ポストフライト（慣性飛行）システムを初期化します。
   */
  public static init(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    system.runInterval(() => {
      for (const player of world.getAllPlayers()) {
        this.tickPlayer(player);
      }
    });
  }

  /**
   * 空中でフックショットが切断された際、着地まで低空気抵抗な慣性飛行（速度維持＋エアストレイフ）を開始します。
   */
  public static start(player: Player, options?: PostFlightOptions): boolean {
    if (
      !player.isValid ||
      player.isOnGround ||
      player.isFlying ||
      player.isGliding ||
      player.isInWater ||
      player.isClimbing
    ) {
      return false;
    }

    const currentVel = player.getVelocity();
    const horizSpeed = Math.hypot(currentVel.x, currentVel.z);
    const minStartSpeed =
      options?.minStartSpeed ?? DEFAULT_POST_FLIGHT_OPTIONS.minStartSpeed;

    if (horizSpeed < minStartSpeed) {
      return false;
    }

    const postFlight: PostFlightState = {
      detachedTick: system.currentTick,
      lastProcessedTick: system.currentTick,
      options,
    };

    PlayerStateManager.set(player.id, POST_FLIGHT_STATE_KEY, postFlight);
    return true;
  }

  /**
   * 慣性飛行を明示的に終了・解除します（フック再発射時や接地時など）。
   */
  public static stop(player: Player): void {
    PlayerStateManager.delete(player.id, POST_FLIGHT_STATE_KEY);
  }

  /**
   * プレイヤーが慣性飛行中かどうかを取得します。
   */
  public static isActive(player: Player): boolean {
    return (
      PlayerStateManager.get<PostFlightState | null>(
        player.id,
        POST_FLIGHT_STATE_KEY,
        null,
      ) !== null
    );
  }

  /**
   * 毎Tickの慣性飛行物理計算とインパルス適用
   */
  public static tickPlayer(player: Player): void {
    const postFlight = PlayerStateManager.get<PostFlightState | null>(
      player.id,
      POST_FLIGHT_STATE_KEY,
      null,
    );
    if (!postFlight) return;

    const impulse = this.calculateImpulse(player, postFlight);
    if (impulse) {
      PlayerStateManager.set(player.id, POST_FLIGHT_STATE_KEY, postFlight);
      if (impulse.x !== 0 || impulse.y !== 0 || impulse.z !== 0) {
        player.applyImpulse(impulse);
      }
    } else {
      this.stop(player);
    }
  }

  /**
   * 切断後の放物線慣性飛行 + Source Engine 風エアストレイフのインパルスを計算します。
   */
  public static calculateImpulse(
    player: Player,
    state: PostFlightState,
  ): Vector3 | null {
    if (!player.isValid) return null;

    // 同一Tick内で切断された直後の場合は次Tickまで待機
    if (state.lastProcessedTick === system.currentTick) {
      return null;
    }

    const opts = state.options;
    const maxTicks = opts?.maxTicks ?? DEFAULT_POST_FLIGHT_OPTIONS.maxTicks;
    const minMaintainSpeed =
      opts?.minMaintainSpeed ?? DEFAULT_POST_FLIGHT_OPTIONS.minMaintainSpeed;
    const retentionXZ =
      opts?.retentionXZ ?? DEFAULT_POST_FLIGHT_OPTIONS.retentionXZ;
    const enableAirStrafe =
      opts?.enableAirStrafe ?? DEFAULT_POST_FLIGHT_OPTIONS.enableAirStrafe;

    // 着地・水中・飛行状態・時間切れで終了
    if (
      state.lastProcessedTick < system.currentTick - 1 ||
      player.isOnGround ||
      player.isFlying ||
      player.isGliding ||
      player.isInWater ||
      player.isClimbing ||
      system.currentTick - state.detachedTick > maxTicks
    ) {
      return null;
    }

    const currentVel = player.getVelocity();
    const horizSpeed = Math.hypot(currentVel.x, currentVel.z);

    // 減速しきったら終了
    if (horizSpeed < minMaintainSpeed) {
      return null;
    }

    state.lastProcessedTick = system.currentTick;

    let nextVx = currentVel.x * retentionXZ;
    let nextVz = currentVel.z * retentionXZ;

    // 空中ストレイフ（速度の絶対値を増大させずに進行軌道を曲げる）
    if (enableAirStrafe) {
      const worldInput = PlayerDirectionResolver.get(player).worldInput;
      if (worldInput.horizontalLength > 0.1) {
        const wishDir = worldInput.normalizedXZ;
        const airWishSpeed =
          opts?.airWishSpeed ?? DEFAULT_POST_FLIGHT_OPTIONS.airWishSpeed;
        const airAccel =
          opts?.airAccel ?? DEFAULT_POST_FLIGHT_OPTIONS.airAccel;
        const currentProj = nextVx * wishDir.x + nextVz * wishDir.z;
        const addSpeed = airWishSpeed - currentProj;

        if (addSpeed > 0) {
          const accelMag = Math.min(airAccel, addSpeed);
          const baseSpeed = Math.hypot(nextVx, nextVz);
          nextVx += wishDir.x * accelMag;
          nextVz += wishDir.z * accelMag;

          const newSpeed = Math.hypot(nextVx, nextVz);
          const maxAllowed = Math.max(baseSpeed, airWishSpeed);
          if (newSpeed > maxAllowed && newSpeed > 0.001) {
            const scale = maxAllowed / newSpeed;
            nextVx *= scale;
            nextVz *= scale;
          }
        }
      }
    }

    return calculateVelocityImpulse({
      targetVelocity: {
        x: nextVx,
        y: null, // Y軸はバニラ重力に任せる
        z: nextVz,
      },
      currentVelocity: currentVel,
      dragXZ: MINECRAFT_DRAG.air.xz,
      dragY: MINECRAFT_DRAG.air.y,
      gravity: MINECRAFT_GRAVITY,
    });
  }
}

/** 慣性飛行開始のショートカット関数 */
export function startPostFlight(
  player: Player,
  options?: PostFlightOptions,
): boolean {
  return PostFlightSystem.start(player, options);
}

/** 慣性飛行解除のショートカット関数 */
export function stopPostFlight(player: Player): void {
  PostFlightSystem.stop(player);
}

/** 慣性飛行インパルス計算のショートカット関数 */
export function calculatePostFlightImpulse(
  player: Player,
  state: PostFlightState,
): Vector3 | null {
  return PostFlightSystem.calculateImpulse(player, state);
}

