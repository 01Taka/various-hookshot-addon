import {
  EquipmentSlot,
  ItemComponentTypes,
  ItemDurabilityComponent,
  ItemStack,
  Player,
  system,
  Vector3,
  world,
} from "@minecraft/server";
import {
  calculateVelocityImpulse,
  getEnchantmentLevel,
  getEquipmentItem,
  getEquippableComponent,
  getItemDurability,
  isSneakButtonPressed,
  ItemDurability,
  MINECRAFT_DRAG,
  MINECRAFT_GRAVITY,
  PlayerDirectionResolver,
  PlayerStateManager,
} from "addon-utils";
import { PostFlightOptions, PostFlightState } from "./types";

export const POST_FLIGHT_STATE_KEY = "hookshotPostFlightState";

export const AERO_VEST_ITEM_ID = "various_hookshot_addon:aero_vest";
export const PHANTOM_AERO_VEST_ITEM_ID =
  "various_hookshot_addon:phantom_aero_vest";

/** 慣性飛行中の耐久消費間隔 (20 ticks = 1秒) */
export const POST_FLIGHT_DURABILITY_INTERVAL_TICKS = 20;

export const DEFAULT_POST_FLIGHT_OPTIONS: Required<PostFlightOptions> = {
  maxTicks: Infinity,
  retentionXZ: 0.992,
  minStartSpeed: 0.2,
  minMaintainSpeed: 0.25,
  airWishSpeed: 0.3,
  airAccel: 0.035,
};

/** 装備中のチェストプレートごとの慣性飛行パラメータ */
export const INERTIA_CHESTPLATE_CONFIGS: Record<string, PostFlightOptions> = {
  [AERO_VEST_ITEM_ID]: {
    retentionXZ: 0.95,
    minStartSpeed: 0.2,
    minMaintainSpeed: 0.25,
    airWishSpeed: 0.3,
    airAccel: 0.035,
  },
  [PHANTOM_AERO_VEST_ITEM_ID]: {
    retentionXZ: 0.992,
    minStartSpeed: 0.2,
    minMaintainSpeed: 0.25,
    airWishSpeed: 0.3,
    airAccel: 0.035,
  },
};

export interface EquippedVestInfo {
  item: ItemStack;
  options: PostFlightOptions;
  durability: ItemDurability | null;
}

export class PostFlightSystem {
  private static isInitialized = false;
  private static suppressors: Array<(player: Player) => boolean> = [];

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
   * いずれかの抑制条件に該当するかを返します。
   */
  public static isSuppressed(player: Player): boolean {
    return this.suppressors.some((predicate) => predicate(player));
  }

  /**
   * プレイヤーが有効な慣性飛行チェストプレートを装備しているか（残り耐久 > 1）を返します。
   */
  public static getEquippedVestInfo(player: Player): EquippedVestInfo | null {
    if (!player.isValid) return null;
    const chestItem = getEquipmentItem(player, EquipmentSlot.Chest);
    if (!chestItem) return null;

    const options = INERTIA_CHESTPLATE_CONFIGS[chestItem.typeId];
    if (!options) return null;

    const durability = getItemDurability(chestItem);
    // エリトラ仕様: 残り耐久が 1（damage >= maxDurability - 1）の場合は機能停止
    if (durability && durability.damage >= durability.maxDurability - 1) {
      return null;
    }

    return { item: chestItem, options, durability };
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

  /**
   * 装備条件・空中条件を満たす場合に慣性飛行を開始します。
   */
  public static start(player: Player, options?: PostFlightOptions): boolean {
    const vestInfo = this.getEquippedVestInfo(player);
    if (!vestInfo || !this.canMaintainFlightState(player)) {
      return false;
    }

    const resolvedOptions = options ?? vestInfo.options;
    const currentVel = player.getVelocity();
    const horizSpeed = Math.hypot(currentVel.x, currentVel.z);
    const minStartSpeed =
      resolvedOptions.minStartSpeed ?? DEFAULT_POST_FLIGHT_OPTIONS.minStartSpeed;

    if (horizSpeed < minStartSpeed) {
      return false;
    }

    const postFlight: PostFlightState = {
      detachedTick: system.currentTick,
      lastProcessedTick: system.currentTick,
      chestplateId: vestInfo.item.typeId,
      activeFlightTicks: 0,
      options: resolvedOptions,
    };

    PlayerStateManager.set(player.id, POST_FLIGHT_STATE_KEY, postFlight);
    return true;
  }

  /**
   * 慣性飛行を明示的に終了・解除します。
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
   * 毎Tickの装備監視・慣性飛行自動開始・物理計算・耐久消費を実行します。
   */
  public static tickPlayer(player: Player): void {
    const vestInfo = this.getEquippedVestInfo(player);
    if (!vestInfo || !this.canMaintainFlightState(player)) {
      if (this.isActive(player)) {
        this.stop(player);
      }
      return;
    }

    let postFlight = PlayerStateManager.get<PostFlightState | null>(
      player.id,
      POST_FLIGHT_STATE_KEY,
      null,
    );

    if (!postFlight) {
      this.start(player, vestInfo.options);
      return;
    }

    // 飛行中に別Tierのベストへ着替えた場合はパラメータを同期
    if (postFlight.chestplateId !== vestInfo.item.typeId) {
      postFlight.chestplateId = vestInfo.item.typeId;
      postFlight.options = vestInfo.options;
    }

    const impulse = this.calculateImpulse(player, postFlight);
    if (!impulse) {
      this.stop(player);
      return;
    }

    postFlight.activeFlightTicks += 1;
    if (
      postFlight.activeFlightTicks % POST_FLIGHT_DURABILITY_INTERVAL_TICKS ===
      0
    ) {
      this.consumeVestDurability(player, vestInfo.item);
    }

    PlayerStateManager.set(player.id, POST_FLIGHT_STATE_KEY, postFlight);
    if (impulse.x !== 0 || impulse.y !== 0 || impulse.z !== 0) {
      player.applyImpulse(impulse);
    }
  }

  /**
   * チェストプレートの耐久値を 1 消費します（耐久力エンチャント考慮、残り耐久 1 で停止）。
   */
  private static consumeVestDurability(player: Player, item: ItemStack): void {
    try {
      const durabilityComp = item.getComponent(
        ItemComponentTypes.Durability,
      ) as ItemDurabilityComponent | undefined;
      if (!durabilityComp) return;

      const maxStopDamage = durabilityComp.maxDurability - 1;
      if (durabilityComp.damage >= maxStopDamage) return;

      const unbreakingLevel = getEnchantmentLevel(item, "unbreaking");
      if (
        unbreakingLevel > 0 &&
        Math.random() >= 1 / (unbreakingLevel + 1)
      ) {
        return;
      }

      durabilityComp.damage = Math.min(durabilityComp.damage + 1, maxStopDamage);
      getEquippableComponent(player)?.setEquipment(EquipmentSlot.Chest, item);

      if (durabilityComp.damage >= maxStopDamage) {
        try {
          player.playSound("random.break", { volume: 0.7, pitch: 1.0 });
        } catch {}
      }
    } catch {}
  }

  /**
   * 慣性飛行 + Source Engine 風エアストレイフのインパルスを計算します。
   */
  public static calculateImpulse(
    player: Player,
    state: PostFlightState,
  ): Vector3 | null {
    if (!player.isValid) return null;

    // 同一Tick内で開始された直後の場合は次Tickまで待機
    if (state.lastProcessedTick === system.currentTick) {
      return null;
    }

    const opts = state.options;
    const maxTicks = opts?.maxTicks ?? DEFAULT_POST_FLIGHT_OPTIONS.maxTicks;
    const minMaintainSpeed =
      opts?.minMaintainSpeed ?? DEFAULT_POST_FLIGHT_OPTIONS.minMaintainSpeed;
    const retentionXZ =
      opts?.retentionXZ ?? DEFAULT_POST_FLIGHT_OPTIONS.retentionXZ;

    // 状態不整合・環境変化・スニーク・時間切れで終了
    if (
      state.lastProcessedTick < system.currentTick - 1 ||
      !this.canMaintainFlightState(player) ||
      (Number.isFinite(maxTicks) &&
        system.currentTick - state.detachedTick > maxTicks)
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
