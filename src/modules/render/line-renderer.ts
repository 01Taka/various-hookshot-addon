import { Vector3Utils } from "@minecraft/math";
import { Dimension, MolangVariableMap, Player, Vector3 } from "@minecraft/server";
import { calculateBambooBendDirection } from "../hookshot/math/bamboo-math";
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
  ): number {
    const { start, end, style, currentLength } = context;
    const diff = Vector3Utils.subtract(end, start);
    const dist = Vector3Utils.magnitude(diff);

    // 距離が極めて近い場合は描画不要
    if (dist < 0.25) return 0;

    let spawnedCount = 0;

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

    // ゴム紐・バネの伸縮間隔表現:
    const isElastic = !!style.elasticSpacing;
    const isRatioSpacing = !!style.ratioSpacing;
    const extraCharge = context.extraCharge ?? 0;
    const maxStep = style.maxStepDistance ?? 2.6;
    const minStep = style.minStepDistance ?? 0.08;

    // 全体長と自然長比率の2軸スコア (1.0=最短・最大圧縮 / 0.0=最長・最大伸長)
    const thicknessScore =
      isRatioSpacing || style.ringRadiusScaling
        ? this.calculateThicknessScore(style, dist, currentLength)
        : 0.5;

    if (isRatioSpacing) {
      step = maxStep - (maxStep - minStep) * thicknessScore;
      step = Math.min(Math.max(step, minStep), maxStep);
    } else if (isElastic && currentLength !== undefined && currentLength > 0.001) {
      const stretch = Math.max(0, dist - currentLength) + extraCharge;
      if (stretch > 0 && style.elasticReferenceStretch) {
        const t = Math.min(1, stretch / style.elasticReferenceStretch);
        const dynamicStep =
          style.stepDistance + (maxStep - style.stepDistance) * t;
        step = Math.min(Math.max(dynamicStep, minStep), maxStep);
      } else {
        const stretchRatio = dist / currentLength;
        let scaledRatio: number;
        if (stretchRatio <= 1.0) {
          scaledRatio = stretchRatio;
        } else {
          const sensitivity = style.elasticSensitivity ?? 3.0;
          scaledRatio = Math.pow(stretchRatio, sensitivity);
        }
        const dynamicStep = style.stepDistance * scaledRatio;
        step = Math.min(Math.max(dynamicStep, minStep), maxStep);
      }
    }

    // 伸縮に応じたパーティクルサイズ・リング半径 (Molang: variable.wire_size)
    let wireMolangVars: MolangVariableMap | undefined;
    let capMolangVars: MolangVariableMap | undefined;
    const isRingMode = (style.ringSliceParticles ?? 0) > 1;
    let ringRadius = style.baseRingRadius ?? 0.24;
    let ringCount = style.ringSliceParticles ?? 1;

    if (style.ringRadiusScaling) {
      const minRadius = style.minRingRadius ?? 0.06;
      const maxRadius = style.maxRingRadius ?? 0.45;
      const minSize = style.minParticleSize ?? 0.08;
      const maxSize = style.maxParticleSize ?? 0.18;

      ringRadius = minRadius + (maxRadius - minRadius) * thicknessScore;
      const wireSize = minSize + (maxSize - minSize) * thicknessScore;

      if (isRingMode) {
        if (ringRadius < 0.08) {
          ringCount = 1;
        } else if (ringRadius < 0.14) {
          ringCount = Math.max(3, Math.floor(ringCount / 2));
        }
      }

      wireMolangVars = new MolangVariableMap();
      wireMolangVars.setFloat("variable.wire_size", wireSize);

      if (isRingMode && ringCount > 1) {
        capMolangVars = new MolangVariableMap();
        capMolangVars.setFloat(
          "variable.wire_size",
          Math.max(wireSize, ringRadius * 0.85),
        );
      }
    } else if (
      style.elasticSizeScaling &&
      currentLength !== undefined &&
      currentLength > 0.001
    ) {
      const baseSize = style.baseParticleSize ?? 0.2;
      const minSize = style.minParticleSize ?? 0.07;
      const maxSize = style.maxParticleSize ?? 0.28;
      const stretch = Math.max(0, dist - currentLength) + extraCharge;
      let wireSize = baseSize;

      if (stretch > 0) {
        const ref = style.elasticReferenceStretch ?? 75.0;
        const t = Math.min(1, stretch / ref);
        wireSize = baseSize - (baseSize - minSize) * t;
      } else if (dist < currentLength) {
        const slackRatio = Math.min(1, (currentLength - dist) / currentLength);
        wireSize = baseSize + (maxSize - baseSize) * slackRatio;
      }

      wireMolangVars = new MolangVariableMap();
      wireMolangVars.setFloat("variable.wire_size", wireSize);
    }

    const particlesPerSlice = isRingMode ? Math.max(1, ringCount) : 1;
    const endpointCenterCount = isRingMode && particlesPerSlice > 1 ? 2 : 0;
    const maxSlices = Math.max(
      2,
      Math.floor(
        (MAX_PARTICLES_PER_WIRE - endpointCenterCount) / particlesPerSlice,
      ),
    );
    const steps = Math.min(
      Math.max(2, Math.floor(pathLength / Math.max(0.05, step))),
      maxSlices,
    );

    // ばね・リング用の直交基底ベクトルの準備
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

    const straightDir = Vector3Utils.scale(diff, 1 / dist);
    let uFixed: Vector3 = { x: 0, y: 0, z: 0 };
    let vFixed: Vector3 = { x: 0, y: 0, z: 0 };
    if (!isBendingSpring && (isSpring || particlesPerSlice > 1)) {
      uFixed = Vector3Utils.normalize(Vector3Utils.cross(straightDir, globalRef));
      vFixed = Vector3Utils.cross(straightDir, uFixed);
    }

    // しなり（弓なり曲げ）用の曲げ方向ベクトルの準備
    const bendDir: Vector3 = isBent
      ? calculateBambooBendDirection(start, end, normal)
      : { x: 0, y: 1, z: 0 };

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
      } else if (isSpring && !isRingMode) {
        const radius = style.amplitude ?? 0.2;
        // 1ブロックあたり約1.2回転
        const theta = dist * t * 1.2 * Math.PI * 2;
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        px += (u.x * cos + v.x * sin) * radius;
        py += (u.y * cos + v.y * sin) * radius;
        pz += (u.z * cos + v.z * sin) * radius;
      }

      if (particlesPerSlice > 1) {
        if (i === 1 || i === steps) {
          this.spawnParticleSafe(
            dimension,
            style.particleId,
            { x: px, y: py, z: pz },
            capMolangVars ?? wireMolangVars,
          );
          spawnedCount++;
        }
        const angleOffset =
          style.ringStagger && i % 2 === 1 ? Math.PI / particlesPerSlice : 0;
        const angleStep = (Math.PI * 2) / particlesPerSlice;
        for (let k = 0; k < particlesPerSlice; k++) {
          const theta = angleOffset + k * angleStep;
          const cos = Math.cos(theta);
          const sin = Math.sin(theta);
          this.spawnParticleSafe(
            dimension,
            style.particleId,
            {
              x: px + (u.x * cos + v.x * sin) * ringRadius,
              y: py + (u.y * cos + v.y * sin) * ringRadius,
              z: pz + (u.z * cos + v.z * sin) * ringRadius,
            },
            wireMolangVars,
          );
          spawnedCount++;
        }
      } else {
        this.spawnParticleSafe(
          dimension,
          style.particleId,
          {
            x: px,
            y: py,
            z: pz,
          },
          wireMolangVars,
        );
        spawnedCount++;
      }
    }

    // アンカー先端パーティクル（着弾点）
    if (style.anchorParticleId) {
      this.spawnParticleSafe(
        dimension,
        style.anchorParticleId,
        end,
        wireMolangVars,
      );
      spawnedCount++;
    }

    return spawnedCount;
  }

  /**
   * 全体の距離と自然長比率の2軸から太さ・密度スコア (0.0〜1.0) を算出します。
   */
  private static calculateThicknessScore(
    style: WireStyle,
    dist: number,
    currentLength?: number,
  ): number {
    const minDist = style.scoreMinDistance ?? 2.0;
    const maxDist = style.scoreMaxDistance ?? 40.0;
    const lengthNorm = Math.min(
      Math.max((dist - minDist) / Math.max(0.001, maxDist - minDist), 0),
      1,
    );
    const lengthScore = 1 - lengthNorm;

    let strainScore: number;
    if (style.scoreDiffRange !== undefined && currentLength !== undefined) {
      const center = style.scoreDiffCenter ?? 0;
      const range = Math.max(0.001, style.scoreDiffRange);
      const exponent = style.scoreDiffExponent ?? 0.65;
      const diffFromCenter = dist - currentLength - center;
      const clampedNorm = Math.min(Math.max(diffFromCenter / range, -1), 1);
      const curved =
        Math.sign(clampedNorm) * Math.pow(Math.abs(clampedNorm), exponent);
      strainScore = 0.5 - 0.5 * curved;
    } else {
      const minRatio = style.scoreMinRatio ?? 0.35;
      const maxRatio = style.scoreMaxRatio ?? 1.8;
      const ratio =
        currentLength !== undefined && currentLength > 0.001
          ? dist / currentLength
          : 1.0;
      const strainNorm = Math.min(
        Math.max((ratio - minRatio) / Math.max(0.001, maxRatio - minRatio), 0),
        1,
      );
      strainScore = 1 - strainNorm;
    }

    const lengthWeight = Math.min(
      Math.max(style.lengthScoreWeight ?? 0.35, 0),
      1,
    );
    return lengthWeight * lengthScore + (1 - lengthWeight) * strainScore;
  }

  private static warnedParticleIds = new Set<string>();

  /**
   * 安全にパーティクルを生成（ディメンション境界・未ロード時の例外を吸収）
   */
  private static spawnParticleSafe(
    dimension: Dimension,
    particleId: string,
    location: Vector3,
    molangVariables?: MolangVariableMap,
  ): void {
    try {
      if (molangVariables) {
        dimension.spawnParticle(particleId, location, molangVariables);
      } else {
        dimension.spawnParticle(particleId, location);
      }
    } catch (e) {
      if (!this.warnedParticleIds.has(particleId)) {
        this.warnedParticleIds.add(particleId);
        console.warn(`[LineRenderer] Failed to spawn particle '${particleId}':`, e);
      }
    }
  }
}
