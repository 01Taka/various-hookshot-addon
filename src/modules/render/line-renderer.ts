import { Vector3Utils } from "@minecraft/math";
import { Dimension, Player, Vector3 } from "@minecraft/server";
import { WireRenderContext, WireStyle } from "./types";

const MAX_PARTICLES_PER_WIRE = 75;

export class LineRenderer {
  /**
   * プレイヤーの手元（右前方のアイテム保持位置）の座標を算出します。
   */
  public static getHandPosition(player: Player): Vector3 {
    const loc = player.location;
    const chest: Vector3 = {
      x: loc.x,
      y: loc.y + 1.2,
      z: loc.z,
    };

    let view: Vector3;
    try {
      view = player.getViewDirection();
    } catch {
      view = { x: 0, y: 0, z: 1 };
    }

    // 水平方向の右ベクトルを外積で計算
    const horizontalLen = Math.hypot(view.x, view.z);
    let right: Vector3;
    if (horizontalLen > 0.001) {
      right = {
        x: -view.z / horizontalLen,
        y: 0,
        z: view.x / horizontalLen,
      };
    } else {
      // ほぼ真上または真下を向いている場合はヨー角から算出
      const rot = player.getRotation();
      const rad = (rot.y * Math.PI) / 180;
      right = {
        x: Math.cos(rad),
        y: 0,
        z: Math.sin(rad),
      };
    }

    // 胸位置から右手前下へオフセット
    return {
      x: chest.x + right.x * 0.3 + view.x * 0.15,
      y: chest.y - 0.18 + view.y * 0.1,
      z: chest.z + right.z * 0.3 + view.z * 0.15,
    };
  }

  /**
   * 2点間を指定スタイルに従ってパーティクルで描画します。
   */
  public static drawWire(
    dimension: Dimension,
    context: WireRenderContext,
  ): void {
    const { start, end, style, currentLength } = context;
    const diff = Vector3Utils.subtract(end, start);
    const dist = Vector3Utils.magnitude(diff);

    // 距離が極めて近い場合は描画不要
    if (dist < 0.25) return;

    // 距離に応じた適応型ステップ幅
    let step = style.stepDistance;
    if (dist > 20) {
      step = Math.max(style.stepDistance * 1.8, 0.7);
    } else if (dist > 8) {
      step = style.stepDistance * 1.3;
    }

    const steps = Math.min(
      Math.max(2, Math.floor(dist / Math.max(0.1, step))),
      MAX_PARTICLES_PER_WIRE,
    );

    // ばね（コイル）用の直交基底ベクトルの準備
    let u: Vector3 = { x: 0, y: 0, z: 0 };
    let v: Vector3 = { x: 0, y: 0, z: 0 };
    if (style.shapeMode === "spring") {
      const dir = Vector3Utils.scale(diff, 1 / dist);
      // dir に平行でない基準ベクトルを選択
      const arbitrary: Vector3 =
        Math.abs(dir.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
      u = Vector3Utils.normalize(Vector3Utils.cross(dir, arbitrary));
      v = Vector3Utils.cross(dir, u);
    }

    // たるみ（放物線）の深度計算
    const slack = Math.max(0, (currentLength ?? dist) - dist);
    const sagDepth = Math.min(slack * (style.amplitude ?? 0.5), 3.5);

    // 始点手前から終点（アンカー手前）まで補間配置
    for (let i = 1; i <= steps; i++) {
      const t = i / (steps + 1);
      let px = start.x + diff.x * t;
      let py = start.y + diff.y * t;
      let pz = start.z + diff.z * t;

      if (style.shapeMode === "sag" && sagDepth > 0.05) {
        // 放物線 4 * sagDepth * t * (1 - t) (t=0.5で最大値 sagDepth)
        const sag = 4 * sagDepth * t * (1 - t);
        py -= sag;
      } else if (style.shapeMode === "spring") {
        const radius = style.amplitude ?? 0.2;
        // 1ブロックあたり約1.2回転
        const theta = dist * t * 1.2 * Math.PI * 2;
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        px += (u.x * cos + v.x * sin) * radius;
        py += (u.y * cos + v.y * sin) * radius;
        pz += (u.z * cos + v.z * sin) * radius;
      }

      this.spawnParticleSafe(dimension, style.particleId, {
        x: px,
        y: py,
        z: pz,
      });
    }

    // アンカー先端パーティクル（着弾点）
    if (style.anchorParticleId) {
      this.spawnParticleSafe(dimension, style.anchorParticleId, end);
    }
  }

  private static warnedParticleIds = new Set<string>();

  /**
   * 安全にパーティクルを生成（ディメンション境界・未ロード時の例外を吸収）
   */
  private static spawnParticleSafe(
    dimension: Dimension,
    particleId: string,
    location: Vector3,
  ): void {
    try {
      dimension.spawnParticle(particleId, location);
    } catch (e) {
      if (!this.warnedParticleIds.has(particleId)) {
        this.warnedParticleIds.add(particleId);
        console.warn(`[LineRenderer] Failed to spawn particle '${particleId}':`, e);
      }
    }
  }
}
