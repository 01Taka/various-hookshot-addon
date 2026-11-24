import { Vector3Utils } from "@minecraft/math";
import {
  Block,
  BlockRaycastHit,
  Dimension,
  EntityComponentTypes,
  EquipmentSlot,
  GameMode,
  ItemComponentTypes,
  ItemStack,
  Player,
  system,
  Vector3,
  world,
} from "@minecraft/server";
import {
  getDirectionVector,
  getMainhandItem,
  isInputButtonPressed,
  isSneakButtonPressed,
  PlayerStateManager,
} from "addon-utils";
import { HookRenderManager, LineRenderer, WireStyle } from "../render";
import { PostFlightSystem } from "../post-flight";
import {
  isElasticAirChainActive,
  markElasticAirLaunch,
  ZiplineHookshotDefinition,
  ZiplineHookshotState,
} from "./definitions";
import { stepZiplineRailAnchor } from "./math/zipline-math";
import {
  calculateAboveAnchorDecayFactor,
  calculateReelSpeedMultiplier,
  calculateRigidSteering,
  canUseGazeSteering,
} from "./math/steering-math";
import {
  DEFAULT_CONTINUOUS_SOUND_INTERVAL_TICKS,
  DEFAULT_PROBING_MIN_HIT_DISTANCE,
  DEFAULT_TIMED_SOUND_INTERVAL_TICKS,
  EPSILON,
  PREVIEW_MIN_RAYCAST_DISTANCE,
  PROJECTION_FALLBACK_DISTANCE,
  RETRACT_END_MIN_DISTANCE,
  RETRACT_START_MIN_DISTANCE,
  TICKS_PER_SECOND,
} from "./constants";
import {
  AirProbingConfig,
  AnchorPosition,
  HookshotDefinition,
  HookshotId,
  HookshotState,
  ReelConfig,
  ReelMode,
  RetractConfig,
} from "./types";

const ACTIVE_HOOK_KEY = "hookshotActiveState";
const PENDING_RAYCAST_KEY = "hookshotPendingRaycast";
const LAST_USE_TICK_KEY = "hookshotLastUseTick";
const UI_ACTIVE_KEY = "hookshotUiActive";

interface PendingRaycastState {
  hookshotId: HookshotId;
  slotIndex?: number;
  remainingTicks: number;
  dimensionId: string;
}

export class HookshotSystem {
  private static definitionsByItem = new Map<string, HookshotDefinition>();
  private static definitionsById = new Map<HookshotId, HookshotDefinition>();
  private static isInitialized = false;

  private static isStateAnchored(state: HookshotState): boolean {
    return "isAnchored" in state ? state.isAnchored !== false : true;
  }

  private static isStateRetracting(state: HookshotState): boolean {
    return (
      (state.hookshotId === "bamboo" ||
        state.hookshotId === "rod" ||
        state.hookshotId === "spring") &&
      !!state.isRetracting
    );
  }

  private static isStateAutoExtending(state: HookshotState): boolean {
    return (
      (state.hookshotId === "bamboo" ||
        state.hookshotId === "rod" ||
        state.hookshotId === "spring") &&
      !!state.isAutoExtending
    );
  }

  private static calculateImpulseForState(
    player: Player,
    def: HookshotDefinition,
    state: HookshotState,
  ): Vector3 {
    switch (def.id) {
      case "bamboo":
        if (state.hookshotId === "bamboo") {
          return def.calculateImpulse(player, state);
        }
        break;
      case "elastic":
        if (state.hookshotId === "elastic") {
          return def.calculateImpulse(player, state);
        }
        break;
      case "rigid":
        if (state.hookshotId === "rigid") {
          return def.calculateImpulse(player, state);
        }
        break;
      case "rod":
        if (state.hookshotId === "rod") {
          return def.calculateImpulse(player, state);
        }
        break;
      case "spring":
        if (state.hookshotId === "spring") {
          return def.calculateImpulse(player, state);
        }
        break;
      case "zipline":
        if (state.hookshotId === "zipline") {
          return def.calculateImpulse(player, state);
        }
        break;
    }
    return { x: 0, y: 0, z: 0 };
  }

  private static resolveWireAxis(
    def: HookshotDefinition,
    state: HookshotState,
  ): Vector3 | undefined {
    if (def.id === "spring" && state.hookshotId === "spring") {
      return def.getWireAxis(state);
    }
    return state.normal;
  }

  private static formatDistanceUiText(
    player: Player,
    def: HookshotDefinition,
    state: HookshotState,
    distance: number,
  ): string {
    if (def.id === "elastic" && state.hookshotId === "elastic") {
      return def.formatDistanceUi(player, state, distance);
    }
    if (def.id === "spring" && state.hookshotId === "spring") {
      return def.formatDistanceUi(player, state, distance);
    }
    if (def.id === "zipline" && state.hookshotId === "zipline") {
      const sign = state.facingDirectionSign ?? 1;
      const remaining = Math.max(
        0,
        sign >= 0 ? state.railLength - state.railProgress : state.railProgress,
      );
      const railSpeed = Math.abs(state.railVelocity) * TICKS_PER_SECOND;
      return `残 ${remaining.toFixed(1)}m / ${state.railLength.toFixed(1)}m | レール ${railSpeed.toFixed(1)} m/s`;
    }
    if (
      def.id === "rigid" &&
      state.hookshotId === "rigid" &&
      canUseGazeSteering(player)
    ) {
      const decayFactor = calculateAboveAnchorDecayFactor(
        state.aboveAnchorTicks ?? 0,
        def.steering,
      );
      const decayPercent = Math.round((1 - decayFactor) * 100);

      const steerResult = calculateRigidSteering(
        player,
        state.anchor,
        def.steering,
      );
      const maxTiltRad = (def.steering.maxUpwardTiltDeg * Math.PI) / 180;
      const rawEffectRatio =
        maxTiltRad > EPSILON
          ? Math.min(1, steerResult.targetTiltRad / maxTiltRad)
          : 0;
      const effectPercent = Math.round(rawEffectRatio * decayFactor * 100);

      return `${distance.toFixed(1)}m / ${state.currentLength.toFixed(1)}m | 減衰:${decayPercent}% 効果:${effectPercent}%`;
    }
    return `${distance.toFixed(1)}m / ${state.currentLength.toFixed(1)}m`;
  }

  /**
   * フックショットの定義を登録します。
   */
  public static register(def: HookshotDefinition): void {
    this.definitionsByItem.set(def.itemTypeId, def);
    this.definitionsById.set(def.id, def);
  }

  /**
   * 指定されたアイテム typeId が登録済みのフックショットアイテムかどうかを判定します。
   */
  public static isHookshotItem(itemTypeId: string): boolean {
    return this.definitionsByItem.has(itemTypeId);
  }

  /**
   * プレイヤーのアクティブなフックショット状態を取得します。
   */
  public static getActiveState(player: Player): HookshotState | null {
    return PlayerStateManager.get<HookshotState | null>(
      player.id,
      ACTIVE_HOOK_KEY,
      null,
    );
  }

  /**
   * フックを解除します。
   */
  public static unhook(
    player: Player,
    options?: { skipReleaseShot?: boolean; overrideSoundId?: string },
  ): void {
    this.clearPendingRaycast(player);

    const state = this.getActiveState(player);
    if (!state || this.isStateRetracting(state)) return;

    const def = this.definitionsById.get(state.hookshotId);

    // チャージ中に解除された場合は、有効なチャージがあれば射出してから解除する
    if (
      !options?.skipReleaseShot &&
      def?.id === "elastic" &&
      state.hookshotId === "elastic" &&
      state.isReelingIn &&
      player.dimension.id === state.anchor.dimensionId
    ) {
      const distance = Vector3Utils.distance(player.location, state.anchor);
      const stretch =
        Math.max(0, distance - state.currentLength) + (state.extraCharge ?? 0);
      if (stretch > def.release.minStretch) {
        state.isReelingIn = false;
        state.isChargeReleasing = true;
        state.releaseShotPending = true;
        const impulse = def.calculateImpulse(player, state);
        if (impulse.x !== 0 || impulse.y !== 0 || impulse.z !== 0) {
          player.applyImpulse(impulse);
        }
        markElasticAirLaunch(player);
        this.playSoundSafe(player, def.release.soundId);
      }
    }

    this.clearDistanceUiIfActive(player);

    if (def?.id === "bamboo" && state.hookshotId === "bamboo") {
      def.onDetach(player, state);
    }

    const isAnchored = this.isStateAnchored(state);
    if (def && isAnchored) {
      if (options?.overrideSoundId) {
        this.playSoundSafe(player, options.overrideSoundId);
      } else if ("detachSoundId" in def) {
        this.playSoundSafe(player, def.detachSoundId);
      }
      this.consumeHookshotDurability(player, def.itemTypeId, state.slotIndex);
    }

    if (
      def &&
      "retract" in def &&
      player.dimension.id === state.anchor.dimensionId &&
      this.startRetract(player, state, def.retract, def.wireStyle)
    ) {
      return;
    }

    PlayerStateManager.delete(player.id, ACTIVE_HOOK_KEY);
  }

  private static getPendingRaycast(player: Player): PendingRaycastState | null {
    return PlayerStateManager.get<PendingRaycastState | null>(
      player.id,
      PENDING_RAYCAST_KEY,
      null,
    );
  }

  private static clearPendingRaycast(player: Player): void {
    if (this.getPendingRaycast(player)) {
      PlayerStateManager.delete(player.id, PENDING_RAYCAST_KEY);
    }
  }

  /**
   * フックを発射・接続します。
   */
  public static shot(player: Player, def: HookshotDefinition): boolean {
    if (def.id === "zipline") {
      this.clearPendingRaycast(player);
      return this.shotZipline(player, def);
    }

    if ("airProbing" in def) {
      this.clearPendingRaycast(player);
      this.enterProbingState(player, def);
      this.playSoundSafe(player, def.shotSoundId);
      return true;
    }

    const hit = player.getBlockFromViewDirection({
      maxDistance: def.maxDistance,
      includeLiquidBlocks: false,
      includePassableBlocks: false,
    });
    if (!hit) {
      const graceTicks = def.raycastGraceTicks;
      if (graceTicks > 0) {
        PlayerStateManager.set(player.id, PENDING_RAYCAST_KEY, {
          hookshotId: def.id,
          slotIndex: player.selectedSlotIndex,
          remainingTicks: graceTicks,
          dimensionId: player.dimension.id,
        } satisfies PendingRaycastState);
        this.playSoundSafe(player, def.shotSoundId);
        return true;
      }
      return false;
    }

    this.playSoundSafe(player, def.shotSoundId);
    this.attachFromHit(player, def, hit);
    return true;
  }

  private static createBaseState(
    player: Player,
    def: HookshotDefinition,
    anchor: AnchorPosition,
    currentLength: number,
  ): HookshotState {
    const common = {
      slotIndex: player.selectedSlotIndex,
      anchor,
      currentLength,
      jumpConsumed:
        isInputButtonPressed(player, "Jump") || player.isJumping,
      sneakConsumed: isSneakButtonPressed(player),
    };
    switch (def.id) {
      case "bamboo":
        return { hookshotId: "bamboo", ...common };
      case "elastic":
        return { hookshotId: "elastic", ...common };
      case "rigid":
        return { hookshotId: "rigid", ...common };
      case "rod":
        return { hookshotId: "rod", ...common };
      case "spring":
        return { hookshotId: "spring", ...common };
      case "zipline":
        return {
          hookshotId: "zipline",
          ...common,
          railBase: { ...anchor },
          railStart: { ...anchor },
          railEnd: { ...anchor },
          startSupportBlock: { ...anchor },
          endSupportBlock: { ...anchor },
          railLength: 0,
          railProgress: 0,
          railVelocity: 0,
        };
    }
  }

  /**
   * 支柱を立てる地面座標から、天井ブロックを考慮した支柱頂点Y座標を算出します。
   */
  private static resolvePillarTopY(
    dimension: Dimension,
    x: number,
    groundY: number,
    z: number,
    pillarHeight: number,
    ceilingClearance: number,
  ): number {
    let pillarTopY = groundY + pillarHeight;
    const ceilingOriginY = groundY + 0.5;
    const ceilingHit = dimension.getBlockFromRay(
      { x, y: ceilingOriginY, z },
      { x: 0, y: 1, z: 0 },
      {
        maxDistance: Math.max(0.5, pillarHeight - 0.5),
        includeLiquidBlocks: false,
        includePassableBlocks: false,
      },
    );
    if (ceilingHit) {
      const ceilNormal = getDirectionVector(ceilingHit.face);
      const ceilingY = ceilingHit.block.y + 0.5 + ceilNormal.y * 0.5;
      pillarTopY = Math.max(
        groundY + 0.5,
        Math.min(pillarTopY, ceilingY - ceilingClearance),
      );
    }
    return pillarTopY;
  }

  /**
   * 支持ブロックが破壊（空気・液体化）されているかを判定します。
   * チャンク未ロード等でブロック取得に失敗した場合は false を返し誤解除を防ぎます。
   */
  private static isSupportBlockBroken(
    dimension: Dimension,
    blockPos: Vector3,
  ): boolean {
    try {
      const block = dimension.getBlock(blockPos);
      if (!block) return false;
      return block.isAir || block.isLiquid;
    } catch {
      return false;
    }
  }

  private static shotZipline(
    player: Player,
    def: ZiplineHookshotDefinition,
  ): boolean {
    const loc = player.location;
    const { halfWidth, maxDownDistance, pillarHeight, ceilingClearance } =
      def.groundCheck;

    const offsets = [
      { dx: -halfWidth, dz: -halfWidth },
      { dx: halfWidth, dz: -halfWidth },
      { dx: -halfWidth, dz: halfWidth },
      { dx: halfWidth, dz: halfWidth },
    ];

    const rayOptions = {
      maxDistance: maxDownDistance + 0.2,
      includeLiquidBlocks: false,
      includePassableBlocks: false,
    };

    const groundHits: { block: Block; surfaceY: number; distSq: number }[] = [];
    for (const { dx, dz } of offsets) {
      const origin: Vector3 = {
        x: loc.x + dx,
        y: loc.y + 0.2,
        z: loc.z + dz,
      };
      const downHit = player.dimension.getBlockFromRay(
        origin,
        { x: 0, y: -1, z: 0 },
        rayOptions,
      );
      if (downHit) {
        const hitNormal = getDirectionVector(downHit.face);
        const surfaceY = downHit.block.y + 0.5 + hitNormal.y * 0.5;
        const cx = downHit.block.x + 0.5;
        const cz = downHit.block.z + 0.5;
        const distSq = (cx - loc.x) * (cx - loc.x) + (cz - loc.z) * (cz - loc.z);
        groundHits.push({ block: downHit.block, surfaceY, distSq });
      }
    }

    if (groundHits.length === 0) {
      this.playSoundSafe(player, def.missSoundId);
      return false;
    }

    // 最高点の地面のうち、プレイヤー中心 (loc.x, loc.z) に最も近いブロックを始点支持ブロックに選ぶ
    const maxGroundY = Math.max(...groundHits.map((h) => h.surfaceY));
    const bestStartHit = groundHits
      .filter((h) => Math.abs(h.surfaceY - maxGroundY) < 0.001)
      .reduce((best, cur) => (cur.distSq < best.distSq ? cur : best));

    const startPillarX = bestStartHit.block.x + 0.5;
    const startPillarZ = bestStartHit.block.z + 0.5;
    const startPillarTopY = this.resolvePillarTopY(
      player.dimension,
      startPillarX,
      maxGroundY,
      startPillarZ,
      pillarHeight,
      ceilingClearance,
    );

    const hit = player.getBlockFromViewDirection({
      maxDistance: def.maxDistance,
      includeLiquidBlocks: false,
      includePassableBlocks: false,
    });
    if (!hit) {
      this.playSoundSafe(player, def.missSoundId);
      return false;
    }

    const normal = getDirectionVector(hit.face);
    const hitFaceCenter: Vector3 = {
      x: hit.block.x + 0.5 + normal.x * 0.5,
      y: hit.block.y + 0.5 + normal.y * 0.5,
      z: hit.block.z + 0.5 + normal.z * 0.5,
    };

    // 着弾ブロック面中心から法線方向へ 0.5m 手前の真下に 5.0m Ray を飛ばし、地面があれば終点支柱を立てる（天井面は除外）
    let endRailBase: Vector3 | undefined;
    let endRailTop: Vector3 | undefined;
    let railEnd: Vector3;
    let endSupportBlock: Vector3;

    const endDownHit =
      normal.y >= -0.2
        ? player.dimension.getBlockFromRay(
            Vector3Utils.add(hitFaceCenter, Vector3Utils.scale(normal, 0.5)),
            { x: 0, y: -1, z: 0 },
            {
              maxDistance: maxDownDistance + 0.5,
              includeLiquidBlocks: false,
              includePassableBlocks: false,
            },
          )
        : undefined;

    if (endDownHit) {
      const endGroundNormal = getDirectionVector(endDownHit.face);
      const endGroundY =
        endDownHit.block.y + 0.5 + endGroundNormal.y * 0.5;
      const endPillarX = endDownHit.block.x + 0.5;
      const endPillarZ = endDownHit.block.z + 0.5;
      const endPillarTopY = this.resolvePillarTopY(
        player.dimension,
        endPillarX,
        endGroundY,
        endPillarZ,
        pillarHeight,
        ceilingClearance,
      );
      endRailBase = { x: endPillarX, y: endGroundY, z: endPillarZ };
      railEnd = { x: endPillarX, y: endPillarTopY, z: endPillarZ };
      endSupportBlock = {
        x: endDownHit.block.x,
        y: endDownHit.block.y,
        z: endDownHit.block.z,
      };
    } else {
      endRailBase = hitFaceCenter;
      endRailTop = Vector3Utils.add(
        hitFaceCenter,
        Vector3Utils.scale(normal, 0.5),
      );
      railEnd = Vector3Utils.add(
        hitFaceCenter,
        Vector3Utils.scale(normal, def.groundCheck.endNormalOffset),
      );
      endSupportBlock = {
        x: hit.block.x,
        y: hit.block.y,
        z: hit.block.z,
      };
    }

    const railBase: Vector3 = {
      x: startPillarX,
      y: maxGroundY,
      z: startPillarZ,
    };
    const railStart: Vector3 = {
      x: startPillarX,
      y: startPillarTopY,
      z: startPillarZ,
    };
    const startSupportBlock: Vector3 = {
      x: bestStartHit.block.x,
      y: bestStartHit.block.y,
      z: bestStartHit.block.z,
    };
    const railLength = Vector3Utils.distance(railStart, railEnd);

    if (railLength < def.groundCheck.minRailLength) {
      this.playSoundSafe(player, def.missSoundId);
      return false;
    }

    const jumpConsumed =
      isInputButtonPressed(player, "Jump") || player.isJumping;
    const sneakConsumed = isSneakButtonPressed(player);

    const state: ZiplineHookshotState = {
      hookshotId: "zipline",
      slotIndex: player.selectedSlotIndex,
      anchor: {
        x: railStart.x,
        y: railStart.y,
        z: railStart.z,
        dimensionId: player.dimension.id,
      },
      normal,
      currentLength:
        !jumpConsumed && !sneakConsumed
          ? def.hangingRopeLength + def.idleSlackOffset
          : def.hangingRopeLength - def.activePullOffset,
      jumpConsumed,
      sneakConsumed,
      railBase,
      endRailBase,
      endRailTop,
      railStart,
      railEnd,
      startSupportBlock,
      endSupportBlock,
      railLength,
      railProgress: 0,
      railVelocity: 0,
      facingDirectionSign: 1,
    };

    PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
    this.playSoundSafe(player, def.shotSoundId);
    this.playSoundSafe(player, def.hitSoundId);
    return true;
  }

  private static updateZiplineAnchor(
    player: Player,
    state: ZiplineHookshotState,
    def: ZiplineHookshotDefinition,
  ): void {
    if (!player.isValid) return;

    let jumpPressed = false;
    let sneakPressed = false;
    try {
      jumpPressed =
        isInputButtonPressed(player, "Jump") || player.isJumping;
      sneakPressed = isSneakButtonPressed(player);
    } catch {
      return;
    }

    let facingSign: 1 | -1 = state.facingDirectionSign ?? 1;
    // Jump / Shift を離している間だけ視線に合わせて正面向きを更新し、押下中は向きをロックする
    if (!jumpPressed && !sneakPressed && state.railLength > 0.0001) {
      try {
        const viewDir = player.getViewDirection();
        const horizViewLen = Math.hypot(viewDir.x, viewDir.z);
        if (horizViewLen >= 0.35) {
          const railDir = Vector3Utils.scale(
            Vector3Utils.subtract(state.railEnd, state.railStart),
            1 / state.railLength,
          );
          const horizRailLen = Math.hypot(railDir.x, railDir.z);
          const dirDot =
            horizRailLen >= 0.2
              ? (viewDir.x * railDir.x + viewDir.z * railDir.z) /
                (horizViewLen * horizRailLen)
              : Vector3Utils.dot(viewDir, railDir);
          if (dirDot >= 0.2) {
            facingSign = 1;
          } else if (dirDot <= -0.2) {
            facingSign = -1;
          }
        }
      } catch {
        // 視線取得失敗時は前回の向きを維持
      }
    }
    state.facingDirectionSign = facingSign;

    const result = stepZiplineRailAnchor({
      railStart: state.railStart,
      railEnd: state.railEnd,
      railLength: state.railLength,
      railProgress: state.railProgress,
      railVelocity: state.railVelocity,
      dimensionId: state.anchor.dimensionId,
      jumpPressed,
      sneakPressed,
      inputDirectionSign: facingSign,
      isOnGround: player.isOnGround,
      playerLocation: player.location,
      config: def.railPhysics,
    });

    state.railProgress = result.railProgress;
    state.railVelocity = result.railVelocity;
    state.anchor = result.anchor;
    state.currentLength =
      !jumpPressed && !sneakPressed
        ? def.hangingRopeLength + def.idleSlackOffset
        : def.hangingRopeLength - def.activePullOffset;

    const absSpeed = Math.abs(state.railVelocity);
    if (absSpeed >= def.slideSound.minSpeed) {
      const lastTick = state.lastSlideSoundTick ?? -def.slideSound.intervalTicks;
      if (system.currentTick - lastTick >= def.slideSound.intervalTicks) {
        const pitch = 0.85 + Math.min(0.6, absSpeed * 0.28);
        this.playSoundSafe(player, def.slideSound.soundId, pitch);
        state.lastSlideSoundTick = system.currentTick;
      }
    }

    PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
  }

  private static attachFromHit(
    player: Player,
    def: HookshotDefinition,
    hit: BlockRaycastHit,
  ): void {
    this.clearPendingRaycast(player);

    const state = this.createBaseState(
      player,
      def,
      { dimensionId: player.dimension.id, x: 0, y: 0, z: 0 },
      0,
    );
    if ("isAnchored" in state) {
      state.isAnchored = true;
    }

    this.applyHitAnchor(
      player,
      state,
      def,
      hit,
      player.getHeadLocation(),
      player.getViewDirection(),
    );
  }

  /**
   * 構え（未着弾・平行移動）状態を開始します。
   */
  private static enterProbingState(
    player: Player,
    def: HookshotDefinition,
  ): void {
    if (!("airProbing" in def)) return;
    const probing = def.airProbing;

    const maxDistance = def.maxDistance;
    const head = player.getHeadLocation();
    const dir = Vector3Utils.normalize(player.getViewDirection());
    const initialLength = Math.min(probing.initialLength, maxDistance);
    const tip = Vector3Utils.add(head, Vector3Utils.scale(dir, initialLength));
    const anchor: AnchorPosition = {
      dimensionId: player.dimension.id,
      x: tip.x,
      y: tip.y,
      z: tip.z,
    };

    const probingState = this.createBaseState(
      player,
      def,
      anchor,
      initialLength,
    );
    if (
      probingState.hookshotId === "bamboo" ||
      probingState.hookshotId === "rod" ||
      probingState.hookshotId === "spring"
    ) {
      probingState.isAnchored = false;
      probingState.probingDirection = dir;
      probingState.isAutoExtending = true;
      probingState.lastAutoExtendTick = system.currentTick;
    }

    PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, probingState);
  }

  /**
   * レイキャスト衝突結果をフックショット状態に反映してアンカー確定処理を行います。
   */
  private static applyHitAnchor(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
    hit: BlockRaycastHit,
    origin: Vector3,
    direction: Vector3,
  ): void {
    const normal = getDirectionVector(hit.face);
    const anchor = this.calculateAnchorPosition(
      player.dimension.id,
      origin,
      direction,
      hit,
      normal,
    );
    const distance = Vector3Utils.distance(player.location, anchor);

    // アンカーからプレイヤーへの初期方向ベクトル（刺さった瞬間の角度）
    // プレイヤーが着弾点に重なっている場合（真下撃ち等）は面法線を使用する
    const initialVector = Vector3Utils.subtract(player.location, anchor);
    const initialDistance = Vector3Utils.magnitude(initialVector);
    const initialDirection =
      initialDistance >= PROJECTION_FALLBACK_DISTANCE
        ? Vector3Utils.scale(initialVector, 1 / initialDistance)
        : normal;

    state.anchor = anchor;
    state.normal = normal;
    state.currentLength = distance;

    if (
      state.hookshotId === "bamboo" ||
      state.hookshotId === "rod" ||
      state.hookshotId === "spring"
    ) {
      state.isAnchored = true;
      state.probingDirection = undefined;
      state.isAutoExtending = false;
    }
    if (state.hookshotId === "spring") {
      state.initialDirection = initialDirection;
      const targetMinLength = Math.min(def.minRopeLength, def.maxDistance);
      state.isAutoExtendingToMin = distance < targetMinLength;
    }
    if (def.id === "rigid" && state.hookshotId === "rigid") {
      state.autoTakeUpRemainingTicks =
        def.autoTakeUp.ticks > 0 ? def.autoTakeUp.ticks : 0;
    }

    PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);

    if (def.id === "bamboo" && state.hookshotId === "bamboo") {
      def.onAttach(player, state);
      PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
    }

    const hitSound =
      "hitSoundId" in def ? def.hitSoundId : def.airProbing.hitSoundId;
    this.playSoundSafe(player, hitSound);
  }

  /**
   * アイテムを持ち替えたか（スロット変更、またはメインハンドのアイテムが別物に変化したか）を判定します。
   */
  private static hasSwitchedItem(
    player: Player,
    expectedItemTypeId: string,
    slotIndex?: number,
  ): boolean {
    if (slotIndex !== undefined && player.selectedSlotIndex !== slotIndex) {
      return true;
    }
    const mainhandItem = getMainhandItem(player);
    return mainhandItem?.typeId !== expectedItemTypeId;
  }

  /**
   * 解除時に使用していたフックショットアイテムの耐久値を1消費します。
   * クリエイティブモードでは消費しません。
   */
  private static consumeHookshotDurability(
    player: Player,
    expectedItemTypeId: string,
    slotIndex?: number,
  ): void {
    if (!player.isValid) return;
    if (player.getGameMode() === GameMode.Creative) return;

    const useMainhand =
      slotIndex === undefined || slotIndex === player.selectedSlotIndex;

    let item: ItemStack | undefined;
    let updateSlot: ((nextItem: ItemStack | undefined) => void) | undefined;

    if (useMainhand) {
      const equippable = player.getComponent(EntityComponentTypes.Equippable);
      if (!equippable) return;
      item = equippable.getEquipment(EquipmentSlot.Mainhand);
      updateSlot = (nextItem) =>
        equippable.setEquipment(EquipmentSlot.Mainhand, nextItem);
    } else {
      const inventory = player.getComponent(EntityComponentTypes.Inventory);
      const container = inventory?.container;
      if (!container || slotIndex < 0 || slotIndex >= container.size) return;
      item = container.getItem(slotIndex);
      updateSlot = (nextItem) => container.setItem(slotIndex, nextItem);
    }

    if (!item || item.typeId !== expectedItemTypeId) return;

    const durability = item.getComponent(ItemComponentTypes.Durability);
    if (!durability) return;

    const enchantable = item.getComponent(ItemComponentTypes.Enchantable);
    const unbreakingLevel =
      enchantable?.getEnchantment("unbreaking")?.level ?? 0;
    if (unbreakingLevel > 0 && Math.random() >= 1 / (unbreakingLevel + 1)) {
      return;
    }

    const nextDamage = durability.damage + 1;
    if (nextDamage >= durability.maxDurability) {
      updateSlot(undefined);
      try {
        player.dimension.playSound("random.break", player.location, {
          volume: 1.0,
          pitch: 1.0,
        });
      } catch {}
    } else {
      durability.damage = nextDamage;
      updateSlot(item);
    }
  }

  /**
   * 構え（未着弾）状態の平行移動・自動伸長とブロック接触判定を更新します。
   */
  private static updateProbingState(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
  ): void {
    if (
      state.hookshotId !== "bamboo" &&
      state.hookshotId !== "rod" &&
      state.hookshotId !== "spring"
    ) {
      return;
    }
    const dir = state.probingDirection;
    if (!dir) return;

    const probing = "airProbing" in def ? def.airProbing : undefined;
    if (state.isAutoExtending && probing) {
      this.applyAutoExtend(player, state, def, probing.extend);
    }

    const head = player.getHeadLocation();
    const minHitDistance =
      probing?.minHitDistance ?? DEFAULT_PROBING_MIN_HIT_DISTANCE;

    const hit = player.dimension.getBlockFromRay(head, dir, {
      maxDistance: state.currentLength,
      includeLiquidBlocks: false,
      includePassableBlocks: false,
    });

    if (hit) {
      const normal = getDirectionVector(hit.face);
      const hitPos = this.calculateAnchorPosition(
        player.dimension.id,
        head,
        dir,
        hit,
        normal,
      );
      const hitDistance = Vector3Utils.distance(head, hitPos);

      if (hitDistance >= minHitDistance) {
        this.applyHitAnchor(player, state, def, hit, head, dir);
        return;
      }
    }

    const tip = Vector3Utils.add(
      head,
      Vector3Utils.scale(dir, state.currentLength),
    );
    state.anchor = {
      dimensionId: player.dimension.id,
      x: tip.x,
      y: tip.y,
      z: tip.z,
    };
    PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
  }

  /**
   * continuous / step 設定に基づいて長さを1Tick分進め（または縮め）、必要な効果音を再生します。
   */
  private static advanceTimedLength(
    player: Player,
    currentLength: number,
    targetLimit: number,
    direction: 1 | -1,
    lastTick: number | undefined,
    config: RetractConfig,
  ): { nextLength: number; nextLastTick: number } {
    const now = system.currentTick;
    let nextLength = currentLength;
    let nextLastTick = lastTick ?? now;

    const clampLength = (val: number) =>
      direction > 0 ? Math.min(val, targetLimit) : Math.max(val, targetLimit);

    if (config.mode === "continuous") {
      if (config.speed > 0) {
        nextLength = clampLength(currentLength + direction * config.speed);
        if (
          nextLength !== currentLength &&
          config.soundId &&
          (direction > 0 || nextLength > 0)
        ) {
          const interval =
            config.soundIntervalTicks ?? DEFAULT_TIMED_SOUND_INTERVAL_TICKS;
          if (now - nextLastTick >= interval) {
            nextLastTick = now;
            this.playSoundSafe(player, config.soundId);
          }
        }
      } else if (direction < 0) {
        nextLength = targetLimit;
      }
    } else if (now - nextLastTick >= config.intervalTicks) {
      nextLastTick = now;
      nextLength = clampLength(currentLength + direction * config.stepLength);
      if (
        nextLength !== currentLength &&
        config.soundId &&
        (direction > 0 || nextLength > 0)
      ) {
        this.playSoundSafe(player, config.soundId);
      }
    }

    return { nextLength, nextLastTick };
  }

  private static applyAutoExtend(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
    extend: AirProbingConfig["extend"],
  ): void {
    if (
      state.hookshotId !== "bamboo" &&
      state.hookshotId !== "rod" &&
      state.hookshotId !== "spring"
    ) {
      return;
    }

    const maxLength = def.maxDistance;

    const { nextLength, nextLastTick } = this.advanceTimedLength(
      player,
      state.currentLength,
      maxLength,
      1,
      state.lastAutoExtendTick,
      extend,
    );
    state.currentLength = nextLength;
    state.lastAutoExtendTick = nextLastTick;

    if (state.currentLength >= maxLength) {
      state.isAutoExtending = false;
    }
  }

  /**
   * 解除時の格納（縮める）アニメーション状態へ移行します。
   */
  private static startRetract(
    player: Player,
    state: HookshotState,
    retract: RetractConfig,
    wireStyle?: WireStyle,
  ): boolean {
    if (
      state.hookshotId !== "bamboo" &&
      state.hookshotId !== "rod" &&
      state.hookshotId !== "spring"
    ) {
      return false;
    }

    let retractDirection: Vector3;
    let retractLength: number;
    let initialRenderDist: number;

    if (state.isAnchored !== false) {
      const toAnchor = Vector3Utils.subtract(state.anchor, player.location);
      const dist = Vector3Utils.magnitude(toAnchor);
      if (dist <= RETRACT_START_MIN_DISTANCE) return false;
      retractDirection = Vector3Utils.scale(toAnchor, 1 / dist);
      retractLength = dist;
      initialRenderDist = Vector3Utils.magnitude(
        Vector3Utils.subtract(state.anchor, LineRenderer.getHandPosition(player)),
      );
    } else {
      retractLength = state.currentLength;
      if (retractLength <= RETRACT_START_MIN_DISTANCE) return false;
      retractDirection = state.probingDirection ?? player.getViewDirection();
      initialRenderDist = retractLength;
    }

    const retractThicknessScore =
      wireStyle && (wireStyle.ratioSpacing || wireStyle.ringRadiusScaling)
        ? LineRenderer.calculateThicknessScore(
            wireStyle,
            initialRenderDist,
            state.currentLength,
          )
        : undefined;

    const retractState: HookshotState = {
      ...state,
      isAnchored: false,
      isAutoExtending: false,
      ...(state.hookshotId === "spring"
        ? { isAutoExtendingToMin: false, lastExtendDistance: undefined }
        : {}),
      isReelingIn: false,
      isRetracting: true,
      retractDirection,
      retractLength,
      retractThicknessScore,
      lastRetractTick:
        retract.mode === "step"
          ? system.currentTick - retract.intervalTicks
          : system.currentTick,
    };

    PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, retractState);
    return true;
  }

  /**
   * 格納中（縮めるアニメーション・クールダウン）の毎Tick更新と描画を行います。
   */
  private static updateRetractingState(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
  ): void {
    if (
      (state.hookshotId !== "bamboo" &&
        state.hookshotId !== "rod" &&
        state.hookshotId !== "spring") ||
      !("retract" in def)
    ) {
      PlayerStateManager.delete(player.id, ACTIVE_HOOK_KEY);
      return;
    }

    const retract = def.retract;
    const dir = state.retractDirection;
    if (!dir) {
      PlayerStateManager.delete(player.id, ACTIVE_HOOK_KEY);
      return;
    }

    const { nextLength: currentLength, nextLastTick } =
      this.advanceTimedLength(
        player,
        state.retractLength ?? 0,
        0,
        -1,
        state.lastRetractTick,
        retract,
      );
    state.lastRetractTick = nextLastTick;

    if (currentLength <= RETRACT_END_MIN_DISTANCE) {
      PlayerStateManager.delete(player.id, ACTIVE_HOOK_KEY);
      return;
    }

    state.retractLength = currentLength;
    PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);

    const head = player.getHeadLocation();
    const tip = Vector3Utils.add(head, Vector3Utils.scale(dir, currentLength));
    HookRenderManager.renderHookshot(
      player,
      tip,
      state.hookshotId,
      def.wireStyle,
      undefined,
      undefined,
      undefined,
      state.retractThicknessScore,
    );
  }

  private static playSoundSafe(
    player: Player,
    soundId?: string,
    pitch?: number,
  ): void {
    if (!soundId) return;
    try {
      if (pitch !== undefined) {
        player.playSound(soundId, { pitch });
      } else {
        player.playSound(soundId);
      }
    } catch {}
  }

  /**
   * チャージ中の伸び量（stretch）に応じたマイルストーン効果音を再生します。
   */
  private static updateChargeMilestoneSound(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
    distance: number,
  ): void {
    if (def.id !== "elastic" || state.hookshotId !== "elastic") return;
    const config = def.chargeMilestoneSound;

    if (!state.isReelingIn) {
      if (
        state.prevChargeStretch !== undefined ||
        state.lastChargeSoundThreshold !== undefined ||
        state.canRetriggerLastThreshold !== undefined
      ) {
        state.prevChargeStretch = undefined;
        state.lastChargeSoundThreshold = undefined;
        state.canRetriggerLastThreshold = undefined;
        PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
      }
      return;
    }

    const stretch =
      Math.max(0, distance - state.currentLength) + (state.extraCharge ?? 0);
    if (stretch <= 0) {
      if (state.prevChargeStretch !== 0) {
        state.prevChargeStretch = 0;
        PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
      }
      return;
    }

    const prev = state.prevChargeStretch ?? stretch;
    let dirty = false;

    if (
      state.lastChargeSoundThreshold !== undefined &&
      !state.canRetriggerLastThreshold &&
      Math.abs(stretch - state.lastChargeSoundThreshold) >= config.hysteresis
    ) {
      state.canRetriggerLastThreshold = true;
      dirty = true;
    }

    const maxSteps = Math.floor(config.maxStretch / config.step);
    for (let i = 1; i <= maxSteps; i++) {
      const threshold = config.step * i;
      const crossedUp = prev < threshold && stretch >= threshold;
      const crossedDown = prev >= threshold && stretch < threshold;
      if (!crossedUp && !crossedDown) continue;

      if (
        state.lastChargeSoundThreshold === threshold &&
        !state.canRetriggerLastThreshold
      ) {
        continue;
      }

      const pitch =
        config.pitches[Math.min(i - 1, config.pitches.length - 1)] ?? 1.0;
      this.playSoundSafe(player, config.soundId, pitch);
      state.lastChargeSoundThreshold = threshold;
      state.canRetriggerLastThreshold = false;
      dirty = true;
    }

    if (state.prevChargeStretch !== stretch) {
      state.prevChargeStretch = stretch;
      dirty = true;
    }

    if (dirty) {
      PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
    }
  }

  /**
   * フックのトグル処理（排他制御対応）
   */
  public static toggleHook(player: Player, def: HookshotDefinition): void {
    const pending = this.getPendingRaycast(player);
    if (pending) {
      this.clearPendingRaycast(player);
      this.clearDistanceUiIfActive(player);
      if (pending.hookshotId === def.id) {
        return;
      }
    }

    const currentState = this.getActiveState(player);

    if (currentState) {
      // 格納中はすべてのフックショットを使用不可にする
      if (this.isStateRetracting(currentState)) {
        return;
      }
      // 既に接続中のフックがある場合
      if (currentState.hookshotId === def.id) {
        // 同じフックショットなら解除（トグル動作）
        this.unhook(player);
        return;
      } else {
        // 異なるフックショットなら、前のフックを解除して新しいフックを発射（排他切り替え）
        this.unhook(player);
        const nextState = this.getActiveState(player);
        if (nextState && this.isStateRetracting(nextState)) {
          return;
        }
        this.shot(player, def);
        return;
      }
    }

    // 未接続なら発射
    this.shot(player, def);
  }

  /**
   * 右クリックイベントの共通ハンドラ
   */
  private static handleUse(player: Player, itemTypeId?: string): void {
    if (!itemTypeId) return;

    const def = this.definitionsByItem.get(itemTypeId);
    if (!def) return;

    // 同一Tickでの重複発火防止 (itemUse と itemStartUseOn の重複抑止)
    const lastTick = PlayerStateManager.get<number | null>(
      player.id,
      LAST_USE_TICK_KEY,
      null,
    );
    if (lastTick === system.currentTick) return;
    PlayerStateManager.set(player.id, LAST_USE_TICK_KEY, system.currentTick);

    this.toggleHook(player, def);
  }

  /**
   * キー入力に応じたロープの伸縮処理を実行します。
   * - ジャンプ（空中時）: 通常方向（デフォルト "shorten"）
   * - スニーク/Shift（空中・接地問わず）: 逆方向（デフォルト "extend"）
   * - 両方同時押し・入力なし: 何もしない
   */
  private static handleReelInput(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
  ): ReelMode | null {
    if (!player.isValid) return null;

    let jumpPressed = false;
    let sneakPressed = false;
    try {
      jumpPressed =
        isInputButtonPressed(player, "Jump") || player.isJumping;
      sneakPressed = isSneakButtonPressed(player);
    } catch {
      return null;
    }

    let stateDirty = false;

    if (!jumpPressed && state.jumpConsumed) {
      state.jumpConsumed = false;
      stateDirty = true;
    }
    if (!sneakPressed && state.sneakConsumed) {
      state.sneakConsumed = false;
      stateDirty = true;
    }

    // 自動伸長中（未着弾構え中またはバネの最小長までの自動伸長中）はジャンプ・シフト入力で中断しない
    if (
      this.isStateAutoExtending(state) ||
      (state.hookshotId === "spring" && !!state.isAutoExtendingToMin)
    ) {
      if (stateDirty) {
        PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
      }
      return null;
    }

    const isChargeReleasing =
      state.hookshotId === "elastic" && !!state.isChargeReleasing;
    const effectiveJumpPressed = jumpPressed && !isChargeReleasing;
    const hasChargeRelease = def.id === "elastic";

    // 両方同時押しなら中立（何もしない。チャージ＆リリース型では発射せずチャージを維持）
    if (effectiveJumpPressed && sneakPressed) {
      if (!hasChargeRelease && state.isReelingIn) {
        state.isReelingIn = false;
        stateDirty = true;
      }
      if (this.resetStepReelState(state)) {
        stateDirty = true;
      }
      if (stateDirty) {
        PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
      }
      return null;
    }

    const baseMode = def.reelMode ?? "shorten";
    const reverseMode = baseMode === "extend" ? "shorten" : "extend";

    // シフト（スニーク）は地上・空中のどちらでも逆方向（長くする）に動作（チャージ＆リリース型では発射せず維持）
    if (sneakPressed) {
      if (!hasChargeRelease && state.isReelingIn) {
        state.isReelingIn = false;
        stateDirty = true;
      }
      const isInitial = !state.sneakConsumed;
      if (isInitial) {
        state.sneakConsumed = true;
        stateDirty = true;
      }
      this.handleDirectionalReel(
        player,
        state,
        def,
        reverseMode,
        isInitial,
        stateDirty,
      );
      return reverseMode;
    }

    // ジャンプは地上・空中のどちらでも通常方向（短くする／ロッドは伸ばす）に動作
    if (effectiveJumpPressed) {
      if (baseMode === "shorten") {
        const stallResult = this.updateRigidStallStop(player, state, def);
        if (stallResult.dirty) {
          stateDirty = true;
        }
        if (
          stallResult.blocked ||
          this.isReelBlockedByLengthDiff(player, state, def, baseMode)
        ) {
          if (state.isReelingIn) {
            state.isReelingIn = false;
            stateDirty = true;
          }
          if (this.resetStepReelState(state)) {
            stateDirty = true;
          }
          if (stateDirty) {
            PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
          }
          return null;
        }
      }
      if (baseMode === "shorten" && !state.isReelingIn) {
        state.isReelingIn = true;
        stateDirty = true;
      }
      const isInitial = !state.jumpConsumed;
      if (isInitial) {
        state.jumpConsumed = true;
        stateDirty = true;
      }
      this.handleDirectionalReel(
        player,
        state,
        def,
        baseMode,
        isInitial,
        stateDirty,
      );
      return baseMode;
    }

    if (state.isReelingIn) {
      state.isReelingIn = false;
      stateDirty = true;
    }
    if (this.resetStepReelState(state)) {
      stateDirty = true;
    }

    if (stateDirty) {
      PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
    }
    return null;
  }

  private static updateRigidStallStop(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
  ): { blocked: boolean; dirty: boolean } {
    if (
      def.id !== "rigid" ||
      state.hookshotId !== "rigid" ||
      !this.isStateAnchored(state)
    ) {
      return { blocked: false, dirty: false };
    }

    const { maxSpeed, ticks, restoreDiff } = def.stallReelStop;
    const distance = Vector3Utils.distance(player.location, state.anchor);
    const diff = distance - state.currentLength;
    const speed = Vector3Utils.magnitude(player.getVelocity());
    const prevTicks = state.stallReelTicks ?? 0;

    if (speed <= maxSpeed && diff >= restoreDiff - 0.01) {
      if (prevTicks >= ticks) {
        let dirty = false;
        if (diff > restoreDiff) {
          state.currentLength = Math.min(
            def.maxDistance,
            distance - restoreDiff,
          );
          dirty = true;
        }
        return { blocked: true, dirty };
      }
      if (diff > restoreDiff) {
        const nextTicks = prevTicks + 1;
        state.stallReelTicks = nextTicks;
        if (nextTicks >= ticks) {
          state.currentLength = Math.min(
            def.maxDistance,
            distance - restoreDiff,
          );
          return { blocked: true, dirty: true };
        }
        return { blocked: false, dirty: true };
      }
    }

    if (prevTicks !== 0) {
      state.stallReelTicks = 0;
      return { blocked: false, dirty: true };
    }
    return { blocked: false, dirty: false };
  }

  private static isReelBlockedByLengthDiff(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
    mode: ReelMode,
  ): boolean {
    const limit = def.reelLengthDiffLimit;
    if (!limit || !this.isStateAnchored(state)) {
      return false;
    }
    const distance = Vector3Utils.distance(player.location, state.anchor);
    if (mode === "shorten" && limit.outward !== undefined) {
      return distance - state.currentLength >= limit.outward;
    }
    if (mode === "extend" && limit.inward !== undefined) {
      return state.currentLength - distance >= limit.inward;
    }
    return false;
  }

  private static shouldDetachOnOverstretch(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
  ): boolean {
    if (!this.isStateAnchored(state)) {
      return false;
    }
    const distance = Vector3Utils.distance(player.location, state.anchor);
    if (def.id === "bamboo") {
      return distance - state.currentLength >= def.maxOverstretchDistance;
    }
    if (def.id === "elastic" && state.hookshotId === "elastic") {
      const stretch =
        Math.max(0, distance - state.currentLength) + (state.extraCharge ?? 0);
      return stretch > def.maxOverstretchDistance;
    }
    return false;
  }

  private static resetStepReelState(state: HookshotState): boolean {
    if (state.hookshotId !== "bamboo" && state.hookshotId !== "rod") {
      return false;
    }
    if (
      state.currentStepIntervalTicks === undefined &&
      state.lastStepMode === undefined
    ) {
      return false;
    }
    state.currentStepIntervalTicks = undefined;
    state.lastStepMode = undefined;
    return true;
  }

  private static handleDirectionalReel(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
    mode: ReelMode,
    isInitial: boolean,
    forceSave: boolean,
  ): void {
    if (this.isStateAutoExtending(state)) {
      if (forceSave) {
        PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
      }
      return;
    }

    this.reel(player, state, def, mode, isInitial, forceSave);
  }

  /**
   * ロープの長さ変更処理（短縮または伸長）
   */
  private static reel(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
    mode: ReelMode,
    isInitial = false,
    forceSave = false,
  ): void {
    const reelConfig = def.reel;

    if (reelConfig.mode === "step") {
      this.reelByStep(player, state, def, reelConfig, mode, isInitial, forceSave);
      return;
    }

    const configuredInitial =
      typeof reelConfig.initialDelta === "object"
        ? mode === "extend"
          ? reelConfig.initialDelta.extend
          : reelConfig.initialDelta.shorten
        : reelConfig.initialDelta;

    const initialStep = isInitial ? (configuredInitial ?? 0) : 0;
    let configuredSpeed =
      typeof reelConfig.speed === "object"
        ? mode === "extend"
          ? reelConfig.speed.extend
          : reelConfig.speed.shorten
        : reelConfig.speed;

    if (
      mode === "shorten" &&
      def.id === "elastic" &&
      this.isStateAnchored(state)
    ) {
      const distance = Vector3Utils.distance(player.location, state.anchor);
      const { minDistance, maxDistance, maxSpeed } = def.distanceReelSpeed;
      const span = Math.max(EPSILON, maxDistance - minDistance);
      const t = Math.min(1, Math.max(0, (distance - minDistance) / span));

      if (isElasticAirChainActive(player)) {
        const { airChainMinSpeed, airChainMaxSpeed } = def.chargeSpeedBoost;
        configuredSpeed = Math.max(
          configuredSpeed,
          airChainMinSpeed + t * (airChainMaxSpeed - airChainMinSpeed),
        );
      } else {
        configuredSpeed = configuredSpeed + t * (maxSpeed - configuredSpeed);
      }
    }

    let baseSpeed = configuredSpeed;
    if (
      mode === "shorten" &&
      this.isStateAnchored(state) &&
      reelConfig.slackSpeed !== undefined
    ) {
      const distance = Vector3Utils.distance(player.location, state.anchor);
      const slack = state.currentLength - distance;
      if (slack >= 0) {
        baseSpeed =
          slack >= reelConfig.slackSpeed
            ? reelConfig.slackSpeed
            : slack + (1 - slack / reelConfig.slackSpeed) * configuredSpeed;
      }
    } else if (
      mode === "shorten" &&
      def.id === "spring" &&
      state.hookshotId === "spring" &&
      this.isStateAnchored(state)
    ) {
      const distance = Vector3Utils.distance(player.location, state.anchor);
      const compression = state.currentLength - distance;
      if (compression > 0) {
        const { brakePerBlock, minSpeedMultiplier } =
          def.shortenCompressionBrake;
        const multiplier = Math.max(
          minSpeedMultiplier,
          1 / (1 + Math.max(0, brakePerBlock) * compression),
        );
        baseSpeed *= multiplier;
      }
    } else if (
      mode === "extend" &&
      def.id === "spring" &&
      state.hookshotId === "spring" &&
      def.matchOutwardExtend &&
      this.isStateAnchored(state)
    ) {
      const distance = Vector3Utils.distance(player.location, state.anchor);
      const prevDistance = state.lastExtendDistance;
      state.lastExtendDistance = distance;
      forceSave = true;
      if (
        !isInitial &&
        prevDistance !== undefined &&
        distance < state.currentLength
      ) {
        const outwardDelta = Math.max(0, distance - prevDistance);
        baseSpeed = Math.max(baseSpeed, outwardDelta);
      }
    }
    let delta = baseSpeed + initialStep;

    // 視線ステアリング対応フックショットでエアロベスト装備中に短縮（巻き取り）する場合、
    // 横・縦の重み付き接線移動速度（遠心力）が強いほど短縮速度を低下させる
    if (
      mode === "shorten" &&
      def.id === "rigid" &&
      def.enableGazeSteering &&
      canUseGazeSteering(player)
    ) {
      const multiplier = calculateReelSpeedMultiplier(
        player,
        state.anchor,
        state.currentLength,
        def.steering,
      );
      delta *= multiplier;
    }

    let continuousSoundId: string | undefined;
    if (reelConfig.soundId) {
      const interval =
        reelConfig.soundIntervalTicks ?? DEFAULT_CONTINUOUS_SOUND_INTERVAL_TICKS;
      const lastSoundTick =
        "lastContinuousReelSoundTick" in state
          ? state.lastContinuousReelSoundTick
          : undefined;
      if (
        isInitial ||
        lastSoundTick === undefined ||
        system.currentTick - lastSoundTick >= interval
      ) {
        continuousSoundId = reelConfig.soundId;
      }
    }

    this.applyLengthDelta(
      player,
      state,
      def,
      mode,
      delta,
      forceSave,
      continuousSoundId,
    );
  }

  /**
   * ステップ式（一定ブロック数＋長押し加速）の伸縮処理
   */
  private static reelByStep(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
    stepConfig: Extract<ReelConfig, { mode: "step" }>,
    mode: ReelMode,
    isInitial: boolean,
    forceSave: boolean,
  ): void {
    if (state.hookshotId !== "bamboo" && state.hookshotId !== "rod") {
      return;
    }

    const now = system.currentTick;
    const isNewDirectionOrTap = isInitial || state.lastStepMode !== mode;

    if (isNewDirectionOrTap) {
      state.lastStepReelTick = now;
      state.currentStepIntervalTicks = stepConfig.initialIntervalTicks;
      state.lastStepMode = mode;
      this.applyLengthDelta(
        player,
        state,
        def,
        mode,
        stepConfig.stepLength,
        true,
        stepConfig.soundId,
      );
      return;
    }

    const lastTick = state.lastStepReelTick ?? now;
    const currentInterval =
      state.currentStepIntervalTicks ?? stepConfig.initialIntervalTicks;

    if (now - lastTick < currentInterval) {
      if (forceSave) {
        PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
      }
      return;
    }

    state.lastStepReelTick = now;
    state.currentStepIntervalTicks = Math.max(
      stepConfig.minIntervalTicks,
      currentInterval - stepConfig.intervalDecayTicks,
    );
    this.applyLengthDelta(
      player,
      state,
      def,
      mode,
      stepConfig.stepLength,
      true,
      stepConfig.soundId,
    );
  }

  private static applyLengthDelta(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
    mode: ReelMode,
    delta: number,
    forceSave: boolean,
    soundId?: string,
  ): void {
    const prevLength = state.currentLength;
    const prevExtra =
      state.hookshotId === "elastic" ? (state.extraCharge ?? 0) : 0;
    let nextLength = prevLength;
    let nextExtra = prevExtra;

    if (mode === "extend") {
      const maxLength = def.maxDistance;
      if (prevExtra > 0) {
        const consumedExtra = Math.min(prevExtra, delta);
        nextExtra = prevExtra - consumedExtra;
        const remaining = delta - consumedExtra;
        if (remaining > 0) {
          nextLength = Math.min(prevLength + remaining, maxLength);
        }
      } else {
        nextLength = Math.min(prevLength + delta, maxLength);
      }
    } else {
      const minLength = def.minRopeLength;
      const maxExtra =
        def.id === "elastic" && this.isStateAnchored(state)
          ? (def.maxExtraCharge ?? Infinity)
          : 0;
      const shortenRoom = Math.max(0, prevLength - minLength);
      if (delta <= shortenRoom) {
        nextLength = Math.max(prevLength - delta, minLength);
      } else {
        nextLength = minLength;
        if (maxExtra > 0) {
          const remaining = delta - shortenRoom;
          nextExtra = Number.isFinite(maxExtra)
            ? Math.min(maxExtra, prevExtra + remaining)
            : prevExtra + remaining;
        }
      }
    }

    const diffLimit = def.reelLengthDiffLimit;
    if (diffLimit && this.isStateAnchored(state)) {
      const distance = Vector3Utils.distance(player.location, state.anchor);
      if (mode === "extend" && diffLimit.inward !== undefined) {
        const maxAllowedByDiff = distance + diffLimit.inward;
        nextLength =
          prevLength >= maxAllowedByDiff
            ? prevLength
            : Math.min(nextLength, maxAllowedByDiff);
      } else if (mode === "shorten" && diffLimit.outward !== undefined) {
        const minAllowedByDiff = distance - diffLimit.outward;
        nextLength =
          prevLength <= minAllowedByDiff
            ? prevLength
            : Math.max(nextLength, minAllowedByDiff);
        if (
          def.id === "rigid" &&
          nextLength <= minAllowedByDiff &&
          state.isReelingIn
        ) {
          state.isReelingIn = false;
          forceSave = true;
        }
      }
    }

    const changed = prevLength !== nextLength || prevExtra !== nextExtra;
    if (changed) {
      state.currentLength = nextLength;
      if (mode === "shorten" && state.hookshotId === "spring") {
        state.lastShortenTick = system.currentTick;
      }
      if (state.hookshotId === "elastic") {
        state.extraCharge = nextExtra;
      }
      if (soundId) {
        if ("lastContinuousReelSoundTick" in state) {
          state.lastContinuousReelSoundTick = system.currentTick;
        }
        this.playSoundSafe(player, soundId);
      }
    }
    if (changed || forceSave) {
      PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
    }
  }

  /**
   * システム初期化・イベント購読開始
   */
  public static init(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // 速度維持（ポストフライト）システムの初期化とフック接続中の抑制登録（構え中は抑制しない）
    PostFlightSystem.init();
    PostFlightSystem.registerSuppressor((player) => {
      const state = this.getActiveState(player);
      return state !== null && this.isStateAnchored(state);
    });

    // 右クリック（空中での使用）
    world.afterEvents.itemUse.subscribe((event) => {
      this.handleUse(event.source, event.itemStack?.typeId);
    });

    // 右クリック（ブロックに対する使用）
    world.afterEvents.itemStartUseOn.subscribe((event) => {
      this.handleUse(event.source, event.itemStack?.typeId);
    });

    // 毎Tickの物理演算および巻き取りループ
    system.runInterval(() => {
      for (const player of world.getAllPlayers()) {
        const state = this.getActiveState(player);
        if (!state) {
          if (this.processPendingRaycast(player)) {
            continue;
          }
          // アンカー設置前: メインハンドにフックショットを持っている場合はプレビュー距離UIを更新
          this.updatePreviewDistanceUi(player);
          continue;
        }

        // ディメンションが変化した場合は自動解除
        if (player.dimension.id !== state.anchor.dimensionId) {
          this.unhook(player);
          continue;
        }

        const def = this.definitionsById.get(state.hookshotId);
        if (!def) continue;

        // 格納中（クールダウン中）は持ち替えに関わらず描画を維持したまま縮め続ける
        if (this.isStateRetracting(state)) {
          this.updateRetractingState(player, state, def);
          continue;
        }

        // アイテムを持ち替えた場合（スロット変更またはメインハンドから別アイテムへ変化）は解除と同等の扱い
        if (this.hasSwitchedItem(player, def.itemTypeId, state.slotIndex)) {
          this.unhook(player);
          continue;
        }

        // キー入力によるロープ長の変更（ジップラインは固定長のためレール上のアンカー移動を更新）
        const wasReelingIn = !!state.isReelingIn;
        const activeReelMode =
          def.id === "zipline" && state.hookshotId === "zipline"
            ? null
            : this.handleReelInput(player, state, def);

        if (def.id === "zipline" && state.hookshotId === "zipline") {
          if (
            this.isSupportBlockBroken(player.dimension, state.startSupportBlock) ||
            this.isSupportBlockBroken(player.dimension, state.endSupportBlock)
          ) {
            this.unhook(player);
            continue;
          }
          this.updateZiplineAnchor(player, state, def);
        }

        if (
          state.hookshotId === "rigid" &&
          activeReelMode !== "shorten" &&
          state.stallReelTicks
        ) {
          state.stallReelTicks = 0;
          PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
        }

        if (this.isStateAnchored(state)) {
          if (
            state.hookshotId === "spring" &&
            state.lastExtendDistance !== undefined &&
            activeReelMode !== "extend"
          ) {
            state.lastExtendDistance = undefined;
            PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
          }
          const distance = Vector3Utils.distance(player.location, state.anchor);
          if (def.id === "rigid" && state.hookshotId === "rigid") {
            const maxAboveTicks = def.steering.aboveAnchorDecayTicks;
            const currentAboveTicks = state.aboveAnchorTicks ?? 0;
            if (
              player.location.y >= state.anchor.y &&
              currentAboveTicks < maxAboveTicks
            ) {
              state.aboveAnchorTicks = currentAboveTicks + 1;
              PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
            }
          }
          this.updateAutoTakeUp(player, state, def, distance, activeReelMode);
          this.updateAutoExtendToMin(player, state, def);

          if (def.id === "elastic" && state.hookshotId === "elastic") {
            let releaseStateDirty = false;

            if (state.isReelingIn) {
              if (
                state.isChargeReleasing ||
                state.releaseShotPending ||
                state.releaseStartTick !== undefined ||
                state.lastReleaseDistance !== undefined ||
                state.releaseStallTicks !== undefined
              ) {
                state.isChargeReleasing = false;
                state.releaseShotPending = false;
                state.releaseStartTick = undefined;
                state.lastReleaseDistance = undefined;
                state.releaseStallTicks = undefined;
                releaseStateDirty = true;
              }
            } else if (wasReelingIn && !state.isReelingIn) {
              const stretch =
                Math.max(0, distance - state.currentLength) +
                (state.extraCharge ?? 0);
              if (stretch <= def.release.minStretch) {
                const minLength = def.minRopeLength;
                const maxLength = def.maxDistance;
                state.currentLength = Math.max(
                  minLength,
                  Math.min(maxLength, distance),
                );
                state.extraCharge = 0;
                state.isChargeReleasing = false;
                state.releaseShotPending = false;
                state.releaseStartTick = undefined;
                state.lastReleaseDistance = undefined;
                state.releaseStallTicks = undefined;
                releaseStateDirty = true;
              } else {
                state.isChargeReleasing = true;
                state.releaseShotPending = true;
                state.releaseStartTick = system.currentTick;
                state.lastReleaseDistance = distance;
                state.releaseStallTicks = 0;
                releaseStateDirty = true;
                markElasticAirLaunch(player);
                this.playSoundSafe(player, def.release.soundId);
              }
            } else if (state.isChargeReleasing) {
              const elapsedTicks =
                system.currentTick -
                (state.releaseStartTick ?? system.currentTick);
              if (distance <= state.currentLength) {
                state.isChargeReleasing = false;
                state.releaseShotPending = false;
                state.releaseStartTick = undefined;
                state.lastReleaseDistance = undefined;
                state.releaseStallTicks = undefined;
                releaseStateDirty = true;
              } else if (elapsedTicks >= def.release.minFlightTicks) {
                const approachSpeed =
                  (state.lastReleaseDistance ?? distance) - distance;
                state.releaseStallTicks =
                  approachSpeed <= def.release.stallApproachSpeed
                    ? (state.releaseStallTicks ?? 0) + 1
                    : 0;
                const isStoppedOrPassed =
                  state.releaseStallTicks >= def.release.maxStallTicks;
                const isGrounded =
                  player.isOnGround || player.isInWater || player.isClimbing;
                const isTimedOut = elapsedTicks >= def.release.maxReleaseTicks;

                if (isStoppedOrPassed || isGrounded || isTimedOut) {
                  const minLength = def.minRopeLength;
                  const maxLength = def.maxDistance;
                  state.currentLength = Math.max(
                    minLength,
                    Math.min(maxLength, distance),
                  );
                  state.isChargeReleasing = false;
                  state.releaseShotPending = false;
                  state.releaseStartTick = undefined;
                  state.lastReleaseDistance = undefined;
                  state.releaseStallTicks = undefined;
                  releaseStateDirty = true;
                } else {
                  state.lastReleaseDistance = distance;
                  releaseStateDirty = true;
                }
              } else {
                state.lastReleaseDistance = distance;
                releaseStateDirty = true;
              }
            }

            if (releaseStateDirty) {
              PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
            }

            this.updateChargeMilestoneSound(player, state, def, distance);
          }
        }

        // 構え中（未着弾）の平行移動およびブロック接触判定
        if (!this.isStateAnchored(state)) {
          this.updateProbingState(player, state, def);
        }

        if (this.isStateAnchored(state)) {
          // 外向き高速突破時に自動解除
          if (this.shouldDetachOnOverstretch(player, state, def)) {
            this.unhook(
              player,
              def.id === "elastic"
                ? {
                    skipReleaseShot: true,
                    overrideSoundId: def.overstretchSoundId,
                  }
                : undefined,
            );
            continue;
          }

          // 物理インパルス計算と適用
          const impulse = this.calculateImpulseForState(player, def, state);
          if (impulse.x !== 0 || impulse.y !== 0 || impulse.z !== 0) {
            player.applyImpulse(impulse);
          }

          if (state.hookshotId === "elastic" && state.releaseShotPending) {
            state.releaseShotPending = false;
            state.extraCharge = 0;
            PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
          }

          // ワイヤーの描画（ジップラインは支柱＋レール＋吊り下げ鎖の3要素を描画）
          if (def.id === "zipline" && state.hookshotId === "zipline") {
            HookRenderManager.renderZipline(player, {
              railBase: state.railBase,
              endRailBase: state.endRailBase,
              endRailTop: state.endRailTop,
              railStart: state.railStart,
              railEnd: state.railEnd,
              startSupportBlock: state.startSupportBlock,
              endSupportBlock: state.endSupportBlock,
              anchor: state.anchor,
              visualChainLength: Math.max(
                0.5,
                state.currentLength - def.railPhysics.torsoHeightOffset,
              ),
              torsoHeightOffset: def.railPhysics.torsoHeightOffset,
              chainStyle: def.wireStyle,
            });
          } else {
            const wireAxis = this.resolveWireAxis(def, state);
            const extraCharge =
              state.hookshotId === "elastic" ? state.extraCharge : undefined;
            HookRenderManager.renderHookshot(
              player,
              state.anchor,
              state.hookshotId,
              def.wireStyle,
              state.currentLength,
              wireAxis,
              extraCharge,
            );
          }
        } else {
          // 構え中はしなり・たるみ無しの直線として描画
          HookRenderManager.renderHookshot(
            player,
            state.anchor,
            state.hookshotId,
            def.wireStyle,
            undefined,
            undefined,
          );
        }

        // 接続中距離UIの更新（○○m / ○○m）
        this.updateDistanceUi(player, state, def);
      }
    });
  }

  /**
   * レイキャスト衝突結果からアンカー座標を計算します。
   */
  private static calculateAnchorPosition(
    dimensionId: string,
    origin: Vector3,
    direction: Vector3,
    hit: BlockRaycastHit,
    normal: Vector3 = getDirectionVector(hit.face),
  ): AnchorPosition {
    // 衝突面の中心座標
    const faceCenterX = hit.block.x + 0.5 + normal.x * 0.5;
    const faceCenterY = hit.block.y + 0.5 + normal.y * 0.5;
    const faceCenterZ = hit.block.z + 0.5 + normal.z * 0.5;

    // レイと平面の交点距離 t
    const dot =
      normal.x * direction.x + normal.y * direction.y + normal.z * direction.z;
    let anchorX = faceCenterX;
    let anchorY = faceCenterY;
    let anchorZ = faceCenterZ;

    if (Math.abs(dot) > 0.0001) {
      const t =
        (normal.x * (faceCenterX - origin.x) +
          normal.y * (faceCenterY - origin.y) +
          normal.z * (faceCenterZ - origin.z)) /
        dot;

      if (t > 0) {
        // 交点座標をブロック面の境界内 [0, 1] にクランプ
        anchorX = Math.max(
          hit.block.x,
          Math.min(hit.block.x + 1, origin.x + direction.x * t),
        );
        anchorY = Math.max(
          hit.block.y,
          Math.min(hit.block.y + 1, origin.y + direction.y * t),
        );
        anchorZ = Math.max(
          hit.block.z,
          Math.min(hit.block.z + 1, origin.z + direction.z * t),
        );
      }
    }

    return {
      dimensionId,
      x: anchorX,
      y: anchorY,
      z: anchorZ,
    };
  }

  /**
   * 発射後の猶予Tick中の視線レイキャスト探索を処理します。
   * 探索中または今Tickで着弾した場合は true を返します。
   */
  private static processPendingRaycast(player: Player): boolean {
    const pending = this.getPendingRaycast(player);
    if (!pending) return false;

    const def = this.definitionsById.get(pending.hookshotId);
    if (
      !def ||
      player.dimension.id !== pending.dimensionId ||
      this.hasSwitchedItem(player, def.itemTypeId, pending.slotIndex)
    ) {
      this.clearPendingRaycast(player);
      this.clearDistanceUiIfActive(player);
      return false;
    }

    const maxDistance = def.maxDistance;
    const hit = player.getBlockFromViewDirection({
      maxDistance,
      includeLiquidBlocks: false,
      includePassableBlocks: false,
    });
    if (hit) {
      this.attachFromHit(player, def, hit);
      return true;
    }

    const remainingTicks = pending.remainingTicks - 1;
    if (remainingTicks <= 0) {
      this.clearPendingRaycast(player);
      this.clearDistanceUiIfActive(player);
      if ("missSoundId" in def) {
        this.playSoundSafe(player, def.missSoundId);
      }
      return false;
    }

    PlayerStateManager.set(player.id, PENDING_RAYCAST_KEY, {
      ...pending,
      remainingTicks,
    });

    try {
      player.onScreenDisplay.setActionBar(
        `[探索中] ${maxDistance.toFixed(1)}m (${remainingTicks}t)`,
      );
      PlayerStateManager.set(player.id, UI_ACTIVE_KEY, true);
    } catch {}

    return true;
  }

  /**
   * アンカー設置前の距離UI（アクションバー）の更新
   * 視線の先のブロックまでの距離 / 持っているフックショットの最大射程
   */
  private static updatePreviewDistanceUi(player: Player): void {
    const mainhandItem = getMainhandItem(player);
    if (!mainhandItem) {
      this.clearDistanceUiIfActive(player);
      return;
    }

    const def = this.definitionsByItem.get(mainhandItem.typeId);
    if (!def) {
      this.clearDistanceUiIfActive(player);
      return;
    }

    const maxDistance = def.maxDistance;
    const raycastDistance = Math.max(maxDistance, PREVIEW_MIN_RAYCAST_DISTANCE);

    const hit = player.getBlockFromViewDirection({
      maxDistance: raycastDistance,
      includeLiquidBlocks: false,
      includePassableBlocks: false,
    });

    if (!hit) {
      this.clearDistanceUiIfActive(player);
      return;
    }

    const anchor = this.calculateAnchorPosition(
      player.dimension.id,
      player.getHeadLocation(),
      player.getViewDirection(),
      hit,
    );
    const distance = Vector3Utils.distance(player.location, anchor);

    try {
      player.onScreenDisplay.setActionBar(
        `${distance.toFixed(1)}m / ${maxDistance.toFixed(1)}m`,
      );
      PlayerStateManager.set(player.id, UI_ACTIVE_KEY, true);
    } catch {
      // プレイヤー切断時などのエラー抑止
    }
  }

  /**
   * フックショットUIが表示中の場合のみアクションバーをクリア
   */
  private static clearDistanceUiIfActive(player: Player): void {
    const isActive = PlayerStateManager.get<boolean>(
      player.id,
      UI_ACTIVE_KEY,
      false,
    );
    if (!isActive) return;

    PlayerStateManager.delete(player.id, UI_ACTIVE_KEY);
    try {
      player.onScreenDisplay.setActionBar("");
    } catch {}
  }

  /**
   * 着弾直後の一定Tick間、ワイヤー長より現在距離が短い場合に高速自動巻き取りを行います。
   */
  private static updateAutoTakeUp(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
    distance: number,
    activeReelMode: ReelMode | null,
  ): void {
    if (def.id !== "rigid" || state.hookshotId !== "rigid") return;
    const remaining = state.autoTakeUpRemainingTicks ?? 0;
    if (remaining <= 0) return;

    const autoTakeUp = def.autoTakeUp;
    if (activeReelMode !== null) {
      state.autoTakeUpRemainingTicks = 0;
      PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
      return;
    }

    const minLength = def.minRopeLength;
    if (distance < state.currentLength) {
      state.currentLength = Math.max(
        minLength,
        distance,
        state.currentLength - autoTakeUp.speed,
      );
    }

    state.autoTakeUpRemainingTicks =
      state.currentLength <= minLength ? 0 : remaining - 1;
    PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
  }

  /**
   * バネフックショットが minRopeLength 未満で着弾した際、minRopeLength まで自動で伸ばします。
   */
  private static updateAutoExtendToMin(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
  ): void {
    if (def.id !== "spring" || state.hookshotId !== "spring") return;
    if (!state.isAutoExtendingToMin) return;

    const targetMinLength = Math.min(def.minRopeLength, def.maxDistance);
    if (state.currentLength >= targetMinLength) {
      state.isAutoExtendingToMin = false;
      PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
      return;
    }

    const stepPerTick = Math.max(0, def.autoExtendToMin.speed);
    const nextLength = Math.min(
      state.currentLength + stepPerTick,
      targetMinLength,
    );
    state.currentLength = nextLength;
    if (nextLength >= targetMinLength) {
      state.isAutoExtendingToMin = false;
    }
    PlayerStateManager.set(player.id, ACTIVE_HOOK_KEY, state);
  }

  /**
   * 接続中距離UI（アクションバー）の更新
   */
  private static updateDistanceUi(
    player: Player,
    state: HookshotState,
    def: HookshotDefinition,
  ): void {
    try {
      if (!this.isStateAnchored(state)) {
        const maxLength = def.maxDistance;
        player.onScreenDisplay.setActionBar(
          `[構え] ${state.currentLength.toFixed(1)}m / ${maxLength.toFixed(1)}m`,
        );
      } else {
        const distance = Vector3Utils.distance(player.location, state.anchor);
        const speed = Vector3Utils.magnitude(player.getVelocity());
        const baseText = this.formatDistanceUiText(
          player,
          def,
          state,
          distance,
        );
        player.onScreenDisplay.setActionBar(
          `${baseText} | ${speed.toFixed(2)} b/t (${(speed * TICKS_PER_SECOND).toFixed(1)} m/s)`,
        );
      }
      PlayerStateManager.set(player.id, UI_ACTIVE_KEY, true);
    } catch {
      // プレイヤー切断時などのエラー抑止
    }
  }
}
