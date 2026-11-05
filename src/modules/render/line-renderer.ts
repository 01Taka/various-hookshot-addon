import { Vector3Utils } from "@minecraft/math";
import { Dimension, Player, Vector3 } from "@minecraft/server";
import { WireRenderContext, WireStyle } from "./types";

const MAX_PARTICLES_PER_WIRE = 500;

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

    // たるみ（放物線）およびしなり（弓なり曲げ）の深度計算
    const isSag = style.shapeMode === "sag";
    const isBent = style.shapeMode === "bent";
    const slack = isSag ? Math.max(0, (currentLength ?? dist) - dist) : 0;
    const compression = isBent ? Math.max(0, (currentLength ?? dist) - dist) : 0;
    const sagDepth = Math.min(slack * (style.amplitude ?? 0.5), 3.5);
    const bendDepth = Math.min(compression * (style.amplitude ?? 0.85), 3.5);

    // 紐の実効長（たるみ・しなり時は放物線の弧長を近似計算）
    const maxDeflection = Math.max(sagDepth, bendDepth);
    const pathLength =
      (isSag && sagDepth > 0.05) || (isBent && bendDepth > 0.05)
        ? Math.sqrt(dist * dist + (16 / 3) * maxDeflection * maxDeflection)
        : dist;

    // 基本ステップ幅（着弾距離によらず一定の基準間隔）
    let step = style.stepDistance;

    // ゴム紐の伸縮表現: 自然長 (currentLength) に対する現在長 (dist) の比率に応じて間隔を伸縮
    // 縮んだ時 (<= 1.0) は等倍（線形）で詰め、伸びた時 (> 1.0) は感度指数により大きく間隔を開ける
    const isElastic = !!style.elasticSpacing;
    if (isElastic && currentLength !== undefined && currentLength > 0.001) {
      const stretchRatio = dist / currentLength;
      let scaledRatio: number;
      if (stretchRatio <= 1.0) {
        // 縮んだ時は等倍（感度指数導入前と同等の線形スケーリング）
        scaledRatio = stretchRatio;
      } else {
        // 伸びた時はより大きく間隔が開くよう感度指数を適用 (デフォルト: 3.0)
        const sensitivity = style.elasticSensitivity ?? 3.0;
        scaledRatio = Math.pow(stretchRatio, sensitivity);
      }

      // 間隔の上下限（間が空きすぎないように上限を適用、詰まりすぎ防止の下限）
      const maxStep = style.maxStepDistance ?? 2.6;
      const minStep = style.minStepDistance ?? 0.08;

      const dynamicStep = style.stepDistance * scaledRatio;
      step = Math.min(Math.max(dynamicStep, minStep), maxStep);
    }

    const steps = Math.min(
      Math.max(2, Math.floor(pathLength / Math.max(0.05, step))),
      MAX_PARTICLES_PER_WIRE,
    );

    // ばね（コイル）用の直交基底ベクトルの準備
    const isSpring = style.shapeMode === "spring";
    const normal = context.normal;
    const isBendingSpring = isSpring && !!normal;

    // 2次ベジェ制御点 (曲げバネ用: アンカーから法線方向へ突き出した制御点 p1)
    const p0: Vector3 = start;
    let p1: Vector3 = { x: 0, y: 0, z: 0 };
    const p2: Vector3 = end;
    if (isBendingSpring && normal) {
      const bendLength = Math.min(Math.max(1.0, dist * 0.45), 8.0);
      p1 = Vector3Utils.add(end, Vector3Utils.scale(normal, bendLength));
    }

    // 直交基底用のグローバル参照ベクトル
    const globalRef: Vector3 =
      Math.abs(diff.y / dist) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };

    let uFixed: Vector3 = { x: 0, y: 0, z: 0 };
    let vFixed: Vector3 = { x: 0, y: 0, z: 0 };
    if (isSpring && !isBendingSpring) {
      const dir = Vector3Utils.scale(diff, 1 / dist);
      uFixed = Vector3Utils.normalize(Vector3Utils.cross(dir, globalRef));
      vFixed = Vector3Utils.cross(dir, uFixed);
    }

    // しなり（弓なり曲げ）用の曲げ方向ベクトルの準備
    let bendDir: Vector3 = { x: 0, y: 1, z: 0 };
    if (isBent) {
      const dir = Vector3Utils.scale(diff, 1 / dist);
      if (normal) {
        const dot = Vector3Utils.dot(normal, dir);
        const perp = Vector3Utils.subtract(normal, Vector3Utils.scale(dir, dot));
        const perpLen = Vector3Utils.magnitude(perp);
        if (perpLen > 0.05) {
          bendDir = Vector3Utils.scale(perp, 1 / perpLen);
        } else {
          const dotUp = Vector3Utils.dot(globalRef, dir);
          const perpUp = Vector3Utils.subtract(globalRef, Vector3Utils.scale(dir, dotUp));
          const perpUpLen = Vector3Utils.magnitude(perpUp);
          bendDir = perpUpLen > 0.05 ? Vector3Utils.scale(perpUp, 1 / perpUpLen) : { x: 0, y: 1, z: 0 };
        }
      } else {
        const dotUp = Vector3Utils.dot(globalRef, dir);
        const perpUp = Vector3Utils.subtract(globalRef, Vector3Utils.scale(dir, dotUp));
        const perpUpLen = Vector3Utils.magnitude(perpUp);
        bendDir = perpUpLen > 0.05 ? Vector3Utils.scale(perpUp, 1 / perpUpLen) : { x: 0, y: 1, z: 0 };
      }
    }

    // 始点手前から終点（アンカー手前）まで補間配置
    for (let i = 1; i <= steps; i++) {
      const t = i / (steps + 1);
      let px: number;
      let py: number;
      let pz: number;
      let u = uFixed;
      let v = vFixed;

      if (isBendingSpring) {
        // 2次ベジェ曲線補間: B(t) = (1-t)^2 * P0 + 2(1-t)t * P1 + t^2 * P2
        const oneMinusT = 1 - t;
        const w0 = oneMinusT * oneMinusT;
        const w1 = 2 * oneMinusT * t;
        const w2 = t * t;

        px = w0 * p0.x + w1 * p1.x + w2 * p2.x;
        py = w0 * p0.y + w1 * p1.y + w2 * p2.y;
        pz = w0 * p0.z + w1 * p1.z + w2 * p2.z;

        // 接線ベクトル dB/dt = 2(1-t)(P1 - P0) + 2t(P2 - P1)
        const tx = 2 * oneMinusT * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
        const ty = 2 * oneMinusT * (p1.y - p0.y) + 2 * t * (p2.y - p1.y);
        const tz = 2 * oneMinusT * (p1.z - p0.z) + 2 * t * (p2.z - p1.z);
        const tLen = Math.hypot(tx, ty, tz);

        if (tLen > 0.0001) {
          const tan = { x: tx / tLen, y: ty / tLen, z: tz / tLen };
          let cross = Vector3Utils.cross(tan, globalRef);
          if (Vector3Utils.magnitude(cross) < 0.1) {
            cross = Vector3Utils.cross(tan, { x: 0, y: 0, z: 1 });
          }
          u = Vector3Utils.normalize(cross);
          v = Vector3Utils.cross(tan, u);
        }
      } else {
        px = start.x + diff.x * t;
        py = start.y + diff.y * t;
        pz = start.z + diff.z * t;
      }

      if (style.shapeMode === "sag" && sagDepth > 0.05) {
        // 放物線 4 * sagDepth * t * (1 - t) (t=0.5で最大値 sagDepth)
        const sag = 4 * sagDepth * t * (1 - t);
        py -= sag;
      } else if (isBent && bendDepth > 0.02) {
        // 圧縮荷重による弓なりのしなり弧: 4 * bendDepth * t * (1 - t)
        const arc = 4 * bendDepth * t * (1 - t);
        px += bendDir.x * arc;
        py += bendDir.y * arc;
        pz += bendDir.z * arc;
      } else if (isSpring) {
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
