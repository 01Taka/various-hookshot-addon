import { Player, system, Vector3, world } from "@minecraft/server";
import {
  calculateVelocityImpulse,
  isSneakButtonPressed,
  MINECRAFT_DRAG,
  MINECRAFT_GRAVITY,
  PlayerDirectionResolver,
  PlayerStateManager,
} from "addon-utils";
import {
  InertiaFlightOptions,
  InertiaFlightProvider,
  InertiaFlightProviderResult,
  InertiaFlightState,
} from "./types";

export const INERTIA_FLIGHT_STATE_KEY = "inertiaFlightState";

export const DEFAULT_INERTIA_FLIGHT_OPTIONS: Required<InertiaFlightOptions> = {
  maxTicks: Infinity,
  retentionXZ: 0.988,
  minStartSpeed: 0.2,
  minMaintainSpeed: 0.25,
  airWishSpeed: 0.3,
  airAccel: 0.035,
};

export class InertiaFlightSystem {
  private static isInitialized = false;
  private static suppressors: Array<(player: Player) => boolean> = [];
  private static providers: InertiaFlightProvider[] = [];

  /**
   * 慣性飛行システムを初期化します。
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
   * フックショット接続中など、慣性飛行を一時抑制する判定関数を登録します。
   */
  public static registerSuppressor(predicate: (player: Player) => boolean): void {
    this.suppressors.push(predicate);
  }

  /**
   * 慣性飛行の有効化条件とパラメータを提供するプロバイダを登録します。
   */
  public static registerProvider(provider: InertiaFlightProvider): void {
    this.providers.push(provider);
  }

  /**
   * いずれかの抑制条件に該当するかを返します。
   */
  public static isSuppressed(player: Player): boolean {
    return this.suppressors.some((predicate) => predicate(player));
  }

  /**
   * プレイヤーが慣性飛行を実行可能な環境・入力状態かを判定します。
   */
  public static canMaintainFlightState(player: Player): boolean {
    return (
      player.isValid &&
      !player.isOnGround &&
      !player.isFlying &&
      !player.isGliding &&
      !player.isInWater &&
      !player.isClimbing &&
      !isSneakButtonPressed(player) &&
      !this.isSuppressed(player)
    );
  }

  private static resolveProvider(
    player: Player,
  ): InertiaFlightProviderResult | null {
    for (const provider of this.providers) {
      const result = provider(player);
      if (result) return result;
    }
    return null;
  }

  /**
   * 空中条件・速度条件を満たす場合に慣性飛行を開始します。
   */
  public static start(
    player: Player,
    options?: InertiaFlightOptions,
    providerId = "custom",
  ): boolean {
    if (!this.canMaintainFlightState(player)) {
      return false;
    }

    const resolvedOptions = options ?? DEFAULT_INERTIA_FLIGHT_OPTIONS;
    const currentVel = player.getVelocity();
    const horizSpeed = Math.hypot(currentVel.x, currentVel.z);
    const minStartSpeed =
      resolvedOptions.minStartSpeed ??
      DEFAULT_INERTIA_FLIGHT_OPTIONS.minStartSpeed;

    if (horizSpeed < minStartSpeed) {
      return false;
    }

    const state: InertiaFlightState = {
      startedTick: system.currentTick,
      lastProcessedTick: system.currentTick,
      providerId,
      activeFlightTicks: 0,
      options: resolvedOptions,
    };

    PlayerStateManager.set(player.id, INERTIA_FLIGHT_STATE_KEY, state);
    return true;
  }

  /**
   * 慣性飛行を明示的に終了・解除します。
   */
  public static stop(player: Player): void {
    PlayerStateManager.delete(player.id, INERTIA_FLIGHT_STATE_KEY);
  }

  /**
   * プレイヤーが慣性飛行中かどうかを取得します。
   */
  public static isActive(player: Player): boolean {
    return (
      PlayerStateManager.get<InertiaFlightState | null>(
        player.id,
        INERTIA_FLIGHT_STATE_KEY,
        null,
      ) !== null
    );
  }

  /**
   * 毎Tickのプロバイダ評価・慣性飛行自動開始・物理計算を実行します。
   */
  public static tickPlayer(player: Player): void {
    const providerResult = this.resolveProvider(player);
    if (!providerResult || !this.canMaintainFlightState(player)) {
      if (this.isActive(player)) {
        this.stop(player);
      }
      return;
    }

    const state = PlayerStateManager.get<InertiaFlightState | null>(
      player.id,
      INERTIA_FLIGHT_STATE_KEY,
      null,
    );

    if (!state) {
      this.start(player, providerResult.options, providerResult.providerId);
      return;
    }

    if (state.providerId !== providerResult.providerId) {
      state.providerId = providerResult.providerId;
      state.options = providerResult.options;
    }

    const impulse = this.calculateImpulse(player, state);
    if (!impulse) {
      this.stop(player);
      return;
    }

    state.activeFlightTicks += 1;
    providerResult.onTickActive?.(player, state.activeFlightTicks);

    PlayerStateManager.set(player.id, INERTIA_FLIGHT_STATE_KEY, state);
    if (impulse.x !== 0 || impulse.y !== 0 || impulse.z !== 0) {
      player.applyImpulse(impulse);
    }
  }

  /**
   * 慣性飛行 + Source Engine 風エアストレイフのインパルスを計算します。
   */
  public static calculateImpulse(
    player: Player,
    state: InertiaFlightState,
  ): Vector3 | null {
    if (!player.isValid) return null;

    if (state.lastProcessedTick === system.currentTick) {
      return null;
    }

    const opts = state.options;
    const maxTicks = opts?.maxTicks ?? DEFAULT_INERTIA_FLIGHT_OPTIONS.maxTicks;
    const minMaintainSpeed =
      opts?.minMaintainSpeed ?? DEFAULT_INERTIA_FLIGHT_OPTIONS.minMaintainSpeed;
    const retentionXZ =
      opts?.retentionXZ ?? DEFAULT_INERTIA_FLIGHT_OPTIONS.retentionXZ;

    if (
      state.lastProcessedTick < system.currentTick - 1 ||
      !this.canMaintainFlightState(player) ||
      (Number.isFinite(maxTicks) &&
        system.currentTick - state.startedTick > maxTicks)
    ) {
      return null;
    }

    const currentVel = player.getVelocity();
    const horizSpeed = Math.hypot(currentVel.x, currentVel.z);

    if (horizSpeed < minMaintainSpeed) {
      return null;
    }

    state.lastProcessedTick = system.currentTick;

    let nextVx = currentVel.x * retentionXZ;
    let nextVz = currentVel.z * retentionXZ;

    const worldInput = PlayerDirectionResolver.get(player).worldInput;
    if (worldInput.horizontalLength > 0.1) {
      const wishDir = worldInput.normalizedXZ;
      const airWishSpeed =
        opts?.airWishSpeed ?? DEFAULT_INERTIA_FLIGHT_OPTIONS.airWishSpeed;
      const airAccel =
        opts?.airAccel ?? DEFAULT_INERTIA_FLIGHT_OPTIONS.airAccel;
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

    return calculateVelocityImpulse({
      targetVelocity: {
        x: nextVx,
        y: null,
        z: nextVz,
      },
      currentVelocity: currentVel,
      dragXZ: MINECRAFT_DRAG.air.xz,
      dragY: MINECRAFT_DRAG.air.y,
      gravity: MINECRAFT_GRAVITY,
    });
  }
}
