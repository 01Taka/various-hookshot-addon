import { Dimension, MolangVariableMap, Vector3 } from "@minecraft/server";

export interface BlockOutlineStyle {
  /** 使用するパーティクルID（デフォルト: "various_hookshot_addon:block_outline"） */
  particleId?: string;
  /** 1辺上のパーティクル間隔 (blocks, デフォルト: 0.25) */
  stepDistance?: number;
  /** ブロック表面からの外側オフセット (blocks, デフォルト: 0.03) */
  padding?: number;
  /** パーティクルサイズ (variable.outline_size, デフォルト: 0.08) */
  particleSize?: number;
  /** パーティクル色 RGBA (0.0〜1.0, デフォルト: アンバー系) */
  color?: {
    r: number;
    g: number;
    b: number;
    a?: number;
  };
}

const DEFAULT_PARTICLE_ID = "various_hookshot_addon:block_outline";
const DEFAULT_STEP_DISTANCE = 0.25;
const DEFAULT_PADDING = 0.03;
const DEFAULT_PARTICLE_SIZE = 0.08;

/**
 * 任意のブロックの12辺（ワイヤーフレーム枠線）をパーティクルで囲んで描画する汎用レンダラー
 */
export class BlockOutlineRenderer {
  private static buildMolangVars(
    style?: BlockOutlineStyle,
  ): MolangVariableMap | undefined {
    if (!style?.color && style?.particleSize === undefined) {
      return undefined;
    }
    const vars = new MolangVariableMap();
    if (style.particleSize !== undefined) {
      vars.setFloat("variable.outline_size", style.particleSize);
    }
    if (style.color) {
      vars.setFloat("variable.color_r", style.color.r);
      vars.setFloat("variable.color_g", style.color.g);
      vars.setFloat("variable.color_b", style.color.b);
      vars.setFloat("variable.color_a", style.color.a ?? 0.9);
    }
    return vars;
  }

  private static spawnSafe(
    dimension: Dimension,
    particleId: string,
    location: Vector3,
    molangVars?: MolangVariableMap,
  ): boolean {
    try {
      if (molangVars) {
        dimension.spawnParticle(particleId, location, molangVars);
      } else {
        dimension.spawnParticle(particleId, location);
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 指定したブロック座標の12辺に沿ってパーティクル枠線を描画します。
   */
  public static drawBlockOutline(
    dimension: Dimension,
    blockPos: Vector3,
    style?: BlockOutlineStyle,
  ): number {
    const particleId = style?.particleId ?? DEFAULT_PARTICLE_ID;
    const stepDistance = Math.max(
      0.1,
      style?.stepDistance ?? DEFAULT_STEP_DISTANCE,
    );
    const padding = style?.padding ?? DEFAULT_PADDING;
    const molangVars = this.buildMolangVars(style);

    const bx = Math.floor(blockPos.x);
    const by = Math.floor(blockPos.y);
    const bz = Math.floor(blockPos.z);

    const minX = bx - padding;
    const maxX = bx + 1 + padding;
    const minY = by - padding;
    const maxY = by + 1 + padding;
    const minZ = bz - padding;
    const maxZ = bz + 1 + padding;

    const span = 1 + padding * 2;
    const segments = Math.max(1, Math.round(span / stepDistance));
    let spawned = 0;

    // 8頂点を1回ずつ描画
    const xs = [minX, maxX];
    const ys = [minY, maxY];
    const zs = [minZ, maxZ];
    for (const x of xs) {
      for (const y of ys) {
        for (const z of zs) {
          if (this.spawnSafe(dimension, particleId, { x, y, z }, molangVars)) {
            spawned++;
          }
        }
      }
    }

    // 12辺の内側補間点を描画（頂点は重複させない）
    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      const vx = minX + span * t;
      const vy = minY + span * t;
      const vz = minZ + span * t;

      for (const y of ys) {
        for (const z of zs) {
          if (
            this.spawnSafe(dimension, particleId, { x: vx, y, z }, molangVars)
          ) {
            spawned++;
          }
        }
      }
      for (const x of xs) {
        for (const z of zs) {
          if (
            this.spawnSafe(dimension, particleId, { x, y: vy, z }, molangVars)
          ) {
            spawned++;
          }
        }
      }
      for (const x of xs) {
        for (const y of ys) {
          if (
            this.spawnSafe(dimension, particleId, { x, y, z: vz }, molangVars)
          ) {
            spawned++;
          }
        }
      }
    }

    return spawned;
  }

  /**
   * 複数ブロックの枠線を重複座標を除いて描画します。
   */
  public static drawBlockOutlines(
    dimension: Dimension,
    blockPositions: readonly Vector3[],
    style?: BlockOutlineStyle,
  ): number {
    const seen = new Set<string>();
    let total = 0;
    for (const pos of blockPositions) {
      const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      total += this.drawBlockOutline(dimension, pos, style);
    }
    return total;
  }
}
