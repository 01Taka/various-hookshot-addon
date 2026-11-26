import { Vector3Utils } from "@minecraft/math";
import {
  BlockRaycastHit,
  Dimension,
  MolangVariableMap,
  Player,
  system,
  Vector3,
} from "@minecraft/server";
import { isInputButtonPressed, isSneakButtonPressed } from "addon-utils";
import {
  BlockOutlineRenderer,
  LineRenderer,
  MAGNET_ATTRACT_OUTLINE_STYLE,
  MAGNET_ATTRACT_WIRE_STYLE,
  MAGNET_GUIDE_WIRE_STYLE,
  MAGNET_NODE_OUTLINE_STYLE,
  MAGNET_REPEL_OUTLINE_STYLE,
  MAGNET_REPEL_WIRE_STYLE,
} from "../../render";
import { EPSILON, PLAYER_CHEST_HEIGHT_OFFSET } from "../constants";
import {
  calculateMagnetEffectRatio,
  calculateMagnetHookshot,
  calculateMagnetSnapLocation,
  MagnetForceMode,
  MagnetPhysicsConfig,
  resolveMagnetContactAxis,
} from "../math/magnet-math";
import {
  AnchorPosition,
  BaseHookshotDefinition,
  BaseHookshotState,
} from "../types";

export const MAGNET_HOOKSHOT_ID = "magnet";
export const MAGNET_ITEM_ID = "various_hookshot_addon:magnet_hookshot";

const MAGNET_STICK_RAY_EXTRA_DISTANCE = 0.25;
const MAGNET_HEAD_STICK_RADIUS = 1.0;
const MAGNET_JITTER_RESNAP_THRESHOLD = 0.15;
const MAGNET_CHARGE_PARTICLE_ID = "various_hookshot_addon:magnet_charge";
const MAGNET_CHARGE_INTERVAL_TICKS = 4;
const MAGNET_STICK_SOUND_ID = "random.click";

export interface MagnetHookshotState
  extends BaseHookshotState<typeof MAGNET_HOOKSHOT_ID> {
  /** 磁化されているブロックの整数座標 */
  blockPos: Vector3;
  /** 現在発動中の磁力モード ("none" / "attract"=Shift / "repel"=Jump) */
  activeMode: MagnetForceMode;
  /** 今Tickがモード開始瞬間（初速／爆発バースト適用Tick）かどうか */
  isModeEntryTick?: boolean;
  /** 一度以上引き寄せまたは反発を実行したかどうか（地上・無入力での自動解除条件） */
  canAutoDetachOnGround?: boolean;
  /** ゼロ速度インパルス固定で吸着中かどうか */
  isStuck?: boolean;
  /** 吸着固定時のスナップ座標（ジッター補正用） */
  stuckLocation?: Vector3;
  /** 動作音再生の直近Tick */
  lastActiveSoundTick?: number;
  /** 反発初回バーストの直近発動Tick */
  lastRepelBurstTick?: number;
  /** 反発入力の連続保持Tick数 */
  repelHoldTicks?: number;
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
  activeSound: {
    soundId: "beacon.ambient",
    intervalTicks: 10,
  },
  physics: {
    fullEffectDistance: 50,
    zeroEffectDistance: 80,
    attractInitialSpeed: 1.6,
    attractAccel: 0.2,
    attractMaxSpeed: 3.0,
    attractNearRadius: 2.0,
    attractNearScale: 1 / 3,
    attractStickRadius: 1.6,
    repelBurstSpeed: 2.2,
    repelSustainAccel: 0.2,
    repelRefDistance: 10.0,
    repelBurstCooldownTicks: 10,
    repelSustainDelayTicks: 5,
    repelSlowFallMinImpulseY: 0.4,
  },
  calculateImpulse: (player, state): Vector3 => {
    return calculateMagnetHookshot(
      player,
      state.anchor,
      state.activeMode,
      !!state.isModeEntryTick,
      !!state.isStuck,
      state.repelHoldTicks ?? 0,
      magnetHookshotDefinition.physics,
    );
  },
};

export type MagnetSoundPlayer = (
  player: Player,
  soundId: string,
  pitch?: number,
) => void;

/**
 * ブロックヒット情報からマグネットフックの初期状態を生成します。
 */
export function createMagnetStateFromHit(
  player: Player,
  hit: BlockRaycastHit,
): MagnetHookshotState {
  const bx = Math.floor(hit.block.x);
  const by = Math.floor(hit.block.y);
  const bz = Math.floor(hit.block.z);
  const blockPos: Vector3 = { x: bx, y: by, z: bz };
  const anchor: AnchorPosition = {
    dimensionId: player.dimension.id,
    x: bx + 0.5,
    y: by + 0.5,
    z: bz + 0.5,
  };

  return {
    hookshotId: MAGNET_HOOKSHOT_ID,
    slotIndex: player.selectedSlotIndex,
    anchor,
    blockPos,
    currentLength: 0,
    jumpConsumed: isInputButtonPressed(player, "Jump") || player.isJumping,
    sneakConsumed: isSneakButtonPressed(player),
    activeMode: "none",
    canAutoDetachOnGround: false,
  };
}

function isMagnetBlockBroken(dimension: Dimension, blockPos: Vector3): boolean {
  try {
    const block = dimension.getBlock(blockPos);
    if (!block) return false;
    return block.isAir || block.isLiquid;
  } catch {
    return false;
  }
}

function resolveDesiredMagnetMode(player: Player): MagnetForceMode {
  let jumpPressed = false;
  let sneakPressed = false;
  try {
    jumpPressed = isInputButtonPressed(player, "Jump") || player.isJumping;
    sneakPressed = isSneakButtonPressed(player);
  } catch {
    return "none";
  }

  if (jumpPressed && sneakPressed) return "none";
  if (sneakPressed) return "attract";
  if (jumpPressed) return "repel";
  return "none";
}

function updateMagnetStickState(
  player: Player,
  state: MagnetHookshotState,
  chestPos: Vector3,
  playSound: MagnetSoundPlayer,
): void {
  if (state.activeMode !== "attract") {
    state.isStuck = false;
    state.stuckLocation = undefined;
    return;
  }

  if (state.isStuck && state.stuckLocation) {
    if (
      Vector3Utils.distance(player.location, state.stuckLocation) >
      MAGNET_JITTER_RESNAP_THRESHOLD
    ) {
      try {
        player.teleport(state.stuckLocation, {
          rotation: player.getRotation(),
          keepVelocity: false,
        });
      } catch {}
    }
    return;
  }

  const dist = Vector3Utils.distance(chestPos, state.anchor);
  if (dist <= EPSILON) return;

  const { dir: contactDir, surfaceDist } = resolveMagnetContactAxis(
    chestPos,
    state.anchor,
  );

  let shouldStick = false;
  try {
    if (
      Vector3Utils.distance(player.getHeadLocation(), state.anchor) <=
      MAGNET_HEAD_STICK_RADIUS
    ) {
      shouldStick = true;
    }
  } catch {}

  if (!shouldStick) {
    try {
      const stickHit = player.dimension.getBlockFromRay(chestPos, contactDir, {
        maxDistance: surfaceDist + MAGNET_STICK_RAY_EXTRA_DISTANCE,
        includeLiquidBlocks: false,
        includePassableBlocks: false,
      });
      if (
        stickHit &&
        Math.floor(stickHit.block.x) === state.blockPos.x &&
        Math.floor(stickHit.block.y) === state.blockPos.y &&
        Math.floor(stickHit.block.z) === state.blockPos.z
      ) {
        shouldStick = true;
      }
    } catch {}
  }

  if (!shouldStick) return;

  const snapLocation = calculateMagnetSnapLocation(
    player.location,
    state.anchor,
    contactDir,
  );
  state.isStuck = true;
  state.stuckLocation = snapLocation;
  try {
    player.teleport(snapLocation, {
      rotation: player.getRotation(),
      keepVelocity: false,
    });
  } catch {}
  playSound(player, MAGNET_STICK_SOUND_ID, 1.4);
}

/**
 * マグネットフックの毎Tick状態更新（ブロック検証・入力・吸着固定・稼働音）を行います。
 * 解除条件（ブロック破壊・ディメンション移動・着地無入力）を満たした場合は false を返します。
 */
export function stepMagnetState(
  player: Player,
  state: MagnetHookshotState,
  def: MagnetHookshotDefinition,
  playSound: MagnetSoundPlayer,
): boolean {
  if (state.anchor.dimensionId !== player.dimension.id) {
    return false;
  }
  if (isMagnetBlockBroken(player.dimension, state.blockPos)) {
    return false;
  }

  const desiredMode = resolveDesiredMagnetMode(player);
  if (desiredMode !== "none") {
    state.canAutoDetachOnGround = true;
  } else if (state.canAutoDetachOnGround && player.isOnGround) {
    return false;
  }

  const prevMode = state.activeMode;
  state.activeMode = desiredMode;
  if (desiredMode === "attract") {
    state.isModeEntryTick = prevMode !== "attract";
    state.repelHoldTicks = 0;
  } else if (desiredMode === "repel") {
    state.repelHoldTicks =
      prevMode !== "repel" ? 0 : (state.repelHoldTicks ?? 0) + 1;
    const cooldown = def.physics.repelBurstCooldownTicks;
    const lastBurst = state.lastRepelBurstTick ?? -cooldown;
    const canBurst =
      prevMode !== "repel" && system.currentTick - lastBurst >= cooldown;
    state.isModeEntryTick = canBurst;
    if (canBurst) {
      state.lastRepelBurstTick = system.currentTick;
    }
  } else {
    state.isModeEntryTick = false;
    state.repelHoldTicks = 0;
  }

  const chestPos: Vector3 = {
    x: player.location.x,
    y: player.location.y + PLAYER_CHEST_HEIGHT_OFFSET,
    z: player.location.z,
  };

  updateMagnetStickState(player, state, chestPos, playSound);

  if (state.activeMode !== "none") {
    const dist = Vector3Utils.distance(chestPos, state.anchor);
    const effectRatio = calculateMagnetEffectRatio(dist, def.physics);
    if (effectRatio > 0) {
      const lastTick =
        state.lastActiveSoundTick ?? -def.activeSound.intervalTicks;
      if (system.currentTick - lastTick >= def.activeSound.intervalTicks) {
        const pitch = state.activeMode === "attract" ? 1.15 : 0.85;
        playSound(player, def.activeSound.soundId, pitch);
        state.lastActiveSoundTick = system.currentTick;
      }
    }
  }

  return true;
}

/**
 * マグネットフックの視覚演出（ガイド4点・ブロック枠線・発動中帯電パーティクル）を描画します。
 */
export function renderMagnetHookshot(
  player: Player,
  state: MagnetHookshotState,
): void {
  const guideParticleId =
    state.activeMode === "attract"
      ? MAGNET_ATTRACT_WIRE_STYLE.particleId
      : state.activeMode === "repel"
        ? MAGNET_REPEL_WIRE_STYLE.particleId
        : MAGNET_GUIDE_WIRE_STYLE.particleId;

  const playerSidePos = LineRenderer.getHandPosition(player);
  const diff = Vector3Utils.subtract(state.anchor, playerSidePos);
  const dist = Vector3Utils.magnitude(diff);

  if (dist > 0.4) {
    const toAnchor = Vector3Utils.scale(diff, 1 / dist);
    const toPlayer = Vector3Utils.scale(toAnchor, -1);

    const points: Vector3[] = [
      Vector3Utils.add(
        playerSidePos,
        Vector3Utils.scale(toAnchor, Math.min(0.6, dist * 0.15)),
      ),
      Vector3Utils.add(
        playerSidePos,
        Vector3Utils.scale(toAnchor, Math.min(1.4, dist * 0.35)),
      ),
      Vector3Utils.add(
        state.anchor,
        Vector3Utils.scale(toPlayer, Math.min(1.0, dist * 0.25)),
      ),
      Vector3Utils.add(
        state.anchor,
        Vector3Utils.scale(toPlayer, Math.min(2.0, dist * 0.45)),
      ),
    ];

    for (const pos of points) {
      try {
        player.dimension.spawnParticle(guideParticleId, pos);
      } catch {}
    }
  }

  const outlineStyle =
    state.activeMode === "attract"
      ? MAGNET_ATTRACT_OUTLINE_STYLE
      : state.activeMode === "repel"
        ? MAGNET_REPEL_OUTLINE_STYLE
        : MAGNET_NODE_OUTLINE_STYLE;

  BlockOutlineRenderer.drawBlockOutline(
    player.dimension,
    state.blockPos,
    outlineStyle,
  );

  if (
    state.activeMode !== "none" &&
    system.currentTick % MAGNET_CHARGE_INTERVAL_TICKS === 0
  ) {
    const color = outlineStyle.color;
    const molangVars = new MolangVariableMap();
    if (color) {
      molangVars.setFloat("variable.color_r", color.r);
      molangVars.setFloat("variable.color_g", color.g);
      molangVars.setFloat("variable.color_b", color.b);
      molangVars.setFloat("variable.color_a", color.a ?? 0.95);
    }
    try {
      player.dimension.spawnParticle(
        MAGNET_CHARGE_PARTICLE_ID,
        state.anchor,
        molangVars,
      );
    } catch {}
  }
}

/**
 * マグネットフックのアクションバー用テキストを整形します。
 */
export function formatMagnetUiText(
  state: MagnetHookshotState,
  def: MagnetHookshotDefinition,
  distance: number,
): string {
  const effectRatio = calculateMagnetEffectRatio(distance, def.physics);
  const effectPercent = Math.round(effectRatio * 100);
  const modeText =
    state.activeMode === "attract"
      ? state.isStuck
        ? "吸着固定(Shift)"
        : "吸引(Shift)"
      : state.activeMode === "repel"
        ? "反発(Jump)"
        : effectRatio <= 0
          ? "待機ゾーン"
          : "待機";
  return `${distance.toFixed(1)}m (効果 ${effectPercent}%) | ${modeText}`;
}
