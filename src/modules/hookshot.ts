import {
  world,
  system,
  Player,
  Vector3,
  ItemUseAfterEvent,
} from "@minecraft/server";
import {
  calculateVelocityImpulse,
  isHoldingItem,
  isSneakButtonPressed,
  PlayerStateManager,
  MINECRAFT_DRAG,
  MINECRAFT_GRAVITY,
} from "addon-utils";

export interface HookState {
  anchor: Vector3;
  anchorBlockPos: Vector3;
  maxDistance: number;
  dimensionId: string;
  activatedTick: number;
}

export const HOOK_STATE_KEY = "hookshot_tether_state";
export const FISHING_ROD_ID = "minecraft:fishing_rod";
export const MAX_RAYCAST_DISTANCE = 48;
export const REEL_IN_SPEED = 0.25; // 巻き取り速度 (blocks/tick = 5.0 blocks/s)
export const MIN_ROPE_LENGTH = 1.5; // 最小半径 (ブロックへの埋まり防止)

/**
 * 視線の先のブロックに向けてフックを発射、または既存フックを解除します。
 */
export function handleHookshotUse(event: ItemUseAfterEvent): void {
  const player = event.source;
  const item = event.itemStack;

  if (item.typeId !== FISHING_ROD_ID) {
    return;
  }

  // 既にフックが接続されている場合は解除（トグル動作）
  if (PlayerStateManager.has(player.id, HOOK_STATE_KEY)) {
    detachHook(player, "§7🪝 フックを解除しました");
    return;
  }

  // 視線の先のブロックを Raycast で取得
  const hit = player.getBlockFromViewDirection({
    maxDistance: MAX_RAYCAST_DISTANCE,
    includeLiquidBlocks: false,
    includePassableBlocks: false,
  });

  if (!hit) {
    player.onScreenDisplay.setActionBar(
      "§c✖ 視線の先にブロックが見つかりませんでした",
    );
    return;
  }

  const block = hit.block;
  const anchorBlockPos: Vector3 = {
    x: block.location.x,
    y: block.location.y,
    z: block.location.z,
  };

  // ブロックの中心をアンカーとする
  const anchor: Vector3 = {
    x: anchorBlockPos.x + 0.5,
    y: anchorBlockPos.y + 0.5,
    z: anchorBlockPos.z + 0.5,
  };

  const playerPos = player.location;
  const playerPoint: Vector3 = {
    x: playerPos.x,
    y: playerPos.y + 1.0,
    z: playerPos.z,
  };

  // 初期距離をロープの最大長 L とする（最低1.5ブロック確保）
  const initialDistance = Math.hypot(
    playerPoint.x - anchor.x,
    playerPoint.y - anchor.y,
    playerPoint.z - anchor.z,
  );
  const maxDistance = Math.max(1.5, initialDistance);

  const hookState: HookState = {
    anchor,
    anchorBlockPos,
    maxDistance,
    dimensionId: player.dimension.id,
    activatedTick: system.currentTick,
  };

  PlayerStateManager.set(player.id, HOOK_STATE_KEY, hookState);

  // フック接続時の演出（SEと通知）
  try {
    player.playSound("item.trident.throw", {
      location: player.location,
      volume: 1.0,
      pitch: 1.2,
    });
  } catch {
    // 効果音再生失敗時は無視
  }

  player.onScreenDisplay.setActionBar(
    `§a🪝 フック接続！ (最大長: ${maxDistance.toFixed(1)}m / 再度右クリックで解除)`,
  );
}

/**
 * フックを解除し、プレイヤーに通知します。
 */
export function detachHook(player: Player, message?: string): void {
  if (PlayerStateManager.has(player.id, HOOK_STATE_KEY)) {
    PlayerStateManager.delete(player.id, HOOK_STATE_KEY);
    if (player.isValid) {
      try {
        player.playSound("random.bowhit", {
          location: player.location,
          volume: 0.8,
          pitch: 0.9,
        });
      } catch {}
      if (message) {
        player.onScreenDisplay.setActionBar(message);
      }
    }
  }
}

/**
 * 物理演算に基づき、ロープ拘束を満たす次のTickの目標速度を計算します。
 *
 * @param currentPos プレイヤーの現在位置（ロープ接続点: 胸部）
 * @param currentVel プレイヤーの現在の速度 (blocks/tick)
 * @param anchor アンカーブロックの中心座標
 * @param maxDistance ロープの最大長 L
 * @param dragXZ 水平方向の空気/水抵抗保持率
 * @param dragY 垂直方向の空気/水抵抗保持率
 * @param gravity 重力加速度 (blocks/tick)
 * @returns 次のTickで到達すべき目標速度ベクトル
 */
export function calculateNextTickTetherVelocity(
  currentPos: Vector3,
  currentVel: Vector3,
  anchor: Vector3,
  maxDistance: number,
  dragXZ: number,
  dragY: number,
  gravity: number,
): Vector3 {
  // 1. 次Tickの自由予測速度 (Minecraft Bedrock の環境物理による減衰と重力)
  const vFree: Vector3 = {
    x: currentVel.x * dragXZ,
    y: (currentVel.y - gravity) * dragY,
    z: currentVel.z * dragXZ,
  };

  // 2. 次Tickの自由予測位置
  const predPos: Vector3 = {
    x: currentPos.x + vFree.x,
    y: currentPos.y + vFree.y,
    z: currentPos.z + vFree.z,
  };

  // 3. アンカーから予測位置への相対ベクトルおよび予測距離
  const rx = predPos.x - anchor.x;
  const ry = predPos.y - anchor.y;
  const rz = predPos.z - anchor.z;
  const predDistance = Math.hypot(rx, ry, rz);

  // 4. ロープがたるんでいる（最大長以内）場合は外力不要（自由落下・運動を維持）
  if (predDistance <= maxDistance || predDistance < 0.0001) {
    return vFree;
  }

  // 5. ロープが張っている（最大長を超える）場合：
  // 拘束面（半径 maxDistance の球面）上の目標位置へ射影
  const scale = maxDistance / predDistance;
  const targetNextPos: Vector3 = {
    x: anchor.x + rx * scale,
    y: anchor.y + ry * scale,
    z: anchor.z + rz * scale,
  };

  // 6. 1Tick で targetNextPos に到達するための必要速度: vNext = targetNextPos - currentPos
  const vNext: Vector3 = {
    x: targetNextPos.x - currentPos.x,
    y: targetNextPos.y - currentPos.y,
    z: targetNextPos.z - currentPos.z,
  };

  return vNext;
}

/**
 * 毎Tick呼び出され、フックが接続されているプレイヤーに物理拘束インパルスを適用します。
 */
export function tickHookshotPhysics(player: Player): void {
  const state = PlayerStateManager.get<HookState | null>(
    player.id,
    HOOK_STATE_KEY,
    null,
  );
  if (!state) {
    return;
  }

  // プレイヤーが無効、または釣竿を持ち替えた場合は解除
  if (!player.isValid || !isHoldingItem(player, FISHING_ROD_ID)) {
    detachHook(player, "§7🪝 釣竿を持ち替えたためフックを解除しました");
    return;
  }

  // 異次元へ移動した場合は解除
  if (player.dimension.id !== state.dimensionId) {
    detachHook(player);
    return;
  }

  // アンカーブロックが破壊されたり空気に変わった場合は解除
  try {
    const anchorBlock = player.dimension.getBlock(state.anchorBlockPos);
    if (!anchorBlock || anchorBlock.isAir || anchorBlock.isLiquid) {
      detachHook(player, "§c✖ アンカーブロックが消失しました");
      return;
    }
  } catch {
    // チャンク未ロード等の場合は維持または解除
  }

  const playerPos = player.location;
  const playerPoint: Vector3 = {
    x: playerPos.x,
    y: playerPos.y + 1.0,
    z: playerPos.z,
  };

  const currentVel = player.getVelocity();

  const currentDist = Math.hypot(
    playerPoint.x - state.anchor.x,
    playerPoint.y - state.anchor.y,
    playerPoint.z - state.anchor.z,
  );

  // シフト（スニーク）ボタンが押されている場合、ロープを巻き取って半径を縮小
  const isReeling = isSneakButtonPressed(player);
  if (isReeling && state.maxDistance > MIN_ROPE_LENGTH) {
    // たるみがあれば現在距離を基準にし、そうでなければ最大長から縮める
    const effectiveBase = Math.min(state.maxDistance, currentDist);
    state.maxDistance = Math.max(
      MIN_ROPE_LENGTH,
      effectiveBase - REEL_IN_SPEED,
    );
    PlayerStateManager.set(player.id, HOOK_STATE_KEY, state);

    // 4Tickに1回、巻き取りチェーンSEを再生
    if (system.currentTick % 4 === 0) {
      try {
        player.playSound("step.chain", {
          location: player.location,
          volume: 0.6,
          pitch: 1.5,
        });
      } catch {}
    }
  }

  // 物理環境パラメータ（水中 or 空中）
  const inWater = player.isInWater;
  const dragXZ = inWater ? MINECRAFT_DRAG.water.xz : MINECRAFT_DRAG.air.xz;
  const dragY = inWater ? MINECRAFT_DRAG.water.y : MINECRAFT_DRAG.air.y;
  const gravity = inWater ? MINECRAFT_GRAVITY * 0.25 : MINECRAFT_GRAVITY;

  // 物理計算により次のTickの目標速度を算出
  const targetVelocity = calculateNextTickTetherVelocity(
    playerPoint,
    currentVel,
    state.anchor,
    state.maxDistance,
    dragXZ,
    dragY,
    gravity,
  );

  // 自由予測速度との差分がある場合（ロープが張った状態）のみインパルスを計算して適用
  const rx = playerPoint.x + currentVel.x * dragXZ - state.anchor.x;
  const ry = playerPoint.y + (currentVel.y - gravity) * dragY - state.anchor.y;
  const rz = playerPoint.z + currentVel.z * dragXZ - state.anchor.z;
  const predictedDist = Math.hypot(rx, ry, rz);

  if (predictedDist > state.maxDistance) {
    const impulse = calculateVelocityImpulse({
      targetVelocity,
      currentVelocity: currentVel,
      dragXZ,
      dragY,
      gravity,
    });

    player.applyImpulse(impulse);
  }

  // ロープのパーティクル描画とアクションバー表示
  renderRopeVisuals(player, playerPoint, state, isReeling);
}

/**
 * ロープの粒子エフェクトおよび状態表示
 */
function renderRopeVisuals(
  player: Player,
  playerPoint: Vector3,
  state: HookState,
  isReeling: boolean,
): void {
  const currentDist = Math.hypot(
    playerPoint.x - state.anchor.x,
    playerPoint.y - state.anchor.y,
    playerPoint.z - state.anchor.z,
  );

  // 状態アクションバー
  if (isReeling) {
    player.onScreenDisplay.setActionBar(
      `§a▲ 巻き取り中: §f${currentDist.toFixed(1)}m / ${state.maxDistance.toFixed(1)}m §7(Shift離すと維持 / 右クリック: 解除)`,
    );
  } else {
    player.onScreenDisplay.setActionBar(
      `§e🪝 フック接続中: §f${currentDist.toFixed(1)}m / ${state.maxDistance.toFixed(1)}m §7(Shift: 巻き取り / 右クリック: 解除)`,
    );
  }

  // パーティクルでロープを可視化（プレイヤーとブロックを結ぶ線上に配置）
  try {
    const dim = player.dimension;
    const steps = Math.min(10, Math.max(3, Math.floor(currentDist * 1.2)));
    for (let i = 1; i <= steps; i++) {
      const t = i / (steps + 1);
      dim.spawnParticle("minecraft:crit", {
        x: playerPoint.x + (state.anchor.x - playerPoint.x) * t,
        y: playerPoint.y + (state.anchor.y - playerPoint.y) * t,
        z: playerPoint.z + (state.anchor.z - playerPoint.z) * t,
      });
    }
  } catch {}
}
