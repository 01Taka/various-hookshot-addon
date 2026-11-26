# Hookshot モジュール構成

`src/modules/hookshot/` は、汎用的なフックショットエンジン（コア）と、プラグイン形式で登録される個別フックショット実装（`hooks/`）で構成されています。

## ディレクトリ構成

```text
src/modules/hookshot/
├── constants.ts            # モジュール全体で共有する物理・判定・サウンド定数
├── types.ts                # 最小限の共通型、ケーパビリティ定義、ライフサイクルフック型
├── hookshot-system.ts      # 汎用フックショットエンジン（個別IDに依存しない）
├── index.ts                # エントリーポイント（定義登録・初期化・公開エクスポート）
├── math/                   # 共通の物理・ステアリング計算ユーティリティ
│   ├── physics-utils.ts    # 空気抵抗・予測物理・ベクトル分解・インパルス変換
│   └── steering-math.ts    # 視線ステアリング・振り子ポンプ・減衰計算
└── hooks/                  # 個別フックショット実装（プラグイン群）
    ├── rod/                # 棒（剛体ロッド）フックショット
    ├── bamboo/             # 竹（しなる弾性ポール）フックショット
    ├── rigid/              # 糸（剛体ロープ・スリングショット）フックショット
    ├── spring/             # スライムボール（双方向バネ）フックショット
    ├── elastic/            # リード（伸縮ゴム・チャージ射出）フックショット
    ├── magnet/             # マグネット（吸引・反発・吸着）フックショット
    └── zipline/            # ジップライン（支柱レール滑走）フックショット
```

---

## コアファイル

| ファイル             | 役割                                                                                                                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `constants.ts`       | 許容誤差 `EPSILON`、空気抵抗・重力補正、格納距離閾値、効果音間隔などの共通定数。                                                                                                                                              |
| `types.ts`           | `BaseHookshotState` / `BaseHookshotDefinition` などの最小共通型、`ReelCapable` / `AirProbingCapable` / `RetractCapable` / `RaycastGraceCapable` ケーパビリティ、および `HookshotContext` と各種ライフサイクルフックの型定義。 |
| `hookshot-system.ts` | フック定義の登録、入力（使用・伸縮）、レイキャスト猶予、構え（`AirProbing`）、格納アニメーション（`Retract`）、耐久値消費、毎Tickの更新ループを管理する汎用エンジン。                                                         |
| `index.ts`           | 7種類のフックショットを `HookshotSystem` へ登録する `initHookshotSystem()` と、外部モジュール向けの再エクスポートを提供。                                                                                                     |

## 共通計算 (`math/`)

| ファイル                | 役割                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `math/physics-utils.ts` | 方向・距離取得、法線成分分解、1Tick自由運動予測、外向き速度クランプ、目標速度から `applyImpulse` 用ベクトルへの変換。  |
| `math/steering-math.ts` | エアロベスト判定（`canUseGazeSteering`）、視線ステアリング加速度・遠心力による巻き取り減速・アンカー上滞在減衰の計算。 |

---

## 個別フックショット (`hooks/<name>/`)

各フックショットは **純粋データ・計算（`config.ts`, `math.ts`）** と **Minecraft API を使う副作用処理（`runtime.ts` またはフェーズ別ファイル）** を分離し、`index.ts` を唯一の公開窓口としています。

### 基本ファイルの役割

| ファイル                                                    | 役割                                                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `type.ts`                                                   | 固有の `State`、`Definition`、物理・挙動パラメータの型定義および ID 定数。                                   |
| `config.ts`                                                 | アイテム ID、射程、物理定数、効果音 ID などの純粋な設定値オブジェクト（バランス調整用）。                    |
| `math.ts`                                                   | プレイヤーやワールドを変更しない純粋な物理・幾何計算関数。                                                   |
| `runtime.ts`                                                | 毎Tick更新・装着/解除フック・HUD整形など、`Player` や `Dimension` を扱う副作用処理。                         |
| `runtime-shot.ts` / `runtime-tick.ts` / `runtime-render.ts` | 規模が大きいフックショット（`elastic`, `magnet`, `zipline`）で `runtime.ts` をフェーズ別に分割したファイル。 |
| `index.ts`                                                  | `config`・`math`・`runtime`（または各フェーズ）を組み合わせて `HookshotDefinition` をエクスポートする窓口。  |

### 各フックショット固有ファイル

- **`hooks/rod/`**（最小構成）
  - `type.ts`, `config.ts`, `math.ts`, `index.ts` — 固有ランタイム処理を持たない双方向剛体棒。
- **`hooks/bamboo/`**（標準構成）
  - `type.ts`, `config.ts`, `math.ts`, `runtime.ts`, `index.ts` — `runtime.ts` で空中連続使用の着地監視、着弾時の速度しなりボーナス、ピン張り SE を管理。
- **`hooks/rigid/`**（標準構成）
  - `type.ts`, `config.ts`, `math.ts`, `runtime.ts`, `index.ts` — `runtime.ts` で着弾直後の高速自動巻き取り（`autoTakeUp`）、失速停止（`stallReelStop`）、アンカー上滞在減衰、HUD 整形を管理。
- **`hooks/spring/`**（標準構成）
  - `type.ts`, `config.ts`, `math.ts`, `runtime.ts`, `index.ts` — `runtime.ts` で `minRopeLength` 未満着弾時の自動伸長、圧縮ブレーキ、外向き追従伸長、曲げ基準軸解決、HUD 整形を管理。
- **`hooks/elastic/`**（フェーズ分割）
  - `type.ts`, `config.ts`, `math.ts`, `runtime-tick.ts`, `index.ts` — `runtime-tick.ts` で空中チェイン監視、パチンコ射出ステートマシン、追加チャージ、マイルストーン SE、HUD 整形を管理。
- **`hooks/magnet/`**（フェーズ分割）
  - `type.ts`, `config.ts`, `math.ts`, `runtime-shot.ts`, `runtime-tick.ts`, `runtime-render.ts`, `index.ts` — 発射磁化（`runtime-shot.ts`）、ブロック破断監視・吸引/反発・吸着固定・HUD 整形（`runtime-tick.ts`）、ガイド点・ブロック枠線・帯電パーティクル描画（`runtime-render.ts`）に分割。
- **`hooks/zipline/`**（フェーズ分割）
  - `type.ts`, `config.ts`, `math.ts`, `runtime-shot.ts`, `runtime-tick.ts`, `runtime-render.ts`, `index.ts` — 4点接地判定と支柱・レール生成（`runtime-shot.ts`）、レール上1次元移動・支持ブロック破壊検知・落下ダメージ保護・HUD 整形（`runtime-tick.ts`）、レールと鎖の専用描画（`runtime-render.ts`）に分割。
