# Minecraft Addon CLI Tool (`minecraft-cli`)

Minecraft 統合版 (Bedrock Edition) アドオンの開発・ビルド・バージョン管理・パッケージングを自動化する汎用 CLI ツールです。

---

## 📁 標準ディレクトリ構造

すべてのアドオンは以下のディレクトリ構造に統一されています：

```text
addon/
├── package.json        # プロジェクト定義（npm scripts、依存関係など）
├── tsconfig.json       # TypeScriptのコンパイル設定 (noEmit: true)
├── .gitignore          # node_modulesやビルド成果物をGit除外
├── README.md           # 本ドキュメント（CLI仕様・AI向けガイド）
│
├── dist/               # ビルド生成物（ビルド時に自動生成）
│   ├── BP/
│   │   ├── manifest.json
│   │   ├── scripts/main.js  # src/main.ts から自動生成されるバンドル
│   │   └── ... (静的アセット)
│   └── RP/
│
├── output/             # パッケージ出力先 (.mcpack, .mcaddon)
│
├── note/               # 設計書・仕様書・メモ等のドキュメント置き場
│
├── src/                # ★TypeScriptのソースコード置き場
│   ├── main.ts         # エントリーポイント（起動ファイル）
│   └── modules/        # 分割したコード
│       ├── custom_item.ts
│       └── utils.ts
│
└── packs/              # ★アドオンのパック置き場
    ├── BP/             # ビヘイビアーパックの静的ファイル置き場
    │   ├── manifest.json
    │   ├── pack_icon.png
    │   ├── entities/   # モブ等のJSON
    │   └── items/      # アイテム等のJSON
    │   ※ここには「scripts/」フォルダは置きません（ビルド時に自動生成されるため）
    │
    └── RP/             # リソースパック（見た目）置き場
        ├── manifest.json
        ├── pack_icon.png
        ├── textures/
        ├── models/
        └── texts/
```

> **重要ルール**:
> - ソースコードのエントリーポイントは **`src/main.ts`** です。
> - パック静的ファイルは **`packs/BP/`** および **`packs/RP/`** 配下に配置します。
> - `packs/BP/manifest.json` のスクリプトエントリーは **`"entry": "scripts/main.js"`** を指定します。
> - `packs/BP/` 直下に手動で `scripts/` フォルダを配置してはいけません（ビルド時に `dist/BP/scripts/main.js` へ自動生成・配置されます）。

---

## 🛠️ 初期セットアップ (`npm link`)

この CLI ツールは `npm link` を使用してグローバルコマンドとしてリンクし、どのディレクトリからでも直接 `minecraft-cli` として呼び出せるようにして利用します。

```bash
# cli-tool ディレクトリ内でグローバルリンクを登録
cd cli-tool
npm link
```

リンクが完了すると、システムのターミナルから `minecraft-cli` コマンドが直接使用可能になります。

---

## 💡 基本的な実行方法（推奨）

アドオンディレクトリ直下で、直接 `minecraft-cli <task> [options]` を実行することが推奨されます：

```bash
# 【推奨】一括ビルド & パッケージング
minecraft-cli all

# ビルドのみ（アセットコピー + tsc + スクリプトバンドル）
minecraft-cli build

# バージョン更新のみ
minecraft-cli version-up

# パッケージングのみ (.mcpack & .mcaddon)
minecraft-cli pack
```

---

## タスク一覧

| タスク名 | 説明 |
| :--- | :--- |
| `all` | **【推奨】** `version-up` → `build` → `pack` を重複なく順番に一括実行します |
| `build` | 静的アセットのコピー、TypeScript 型チェック (`tsc`)、スクリプトバンドル (`src/main.ts` → `dist/BP/scripts/main.js`) を実行します |
| `version-up` | `manifest.json` 内のバージョン表記（header, modules, BP内のRP依存UUID）をインクリメントします |
| `pack` | `dist/` を ZIP 圧縮し、`output/` 直下にのみ `.mcpack` / `.mcaddon` を生成します（※デフォルトで事前にバージョン更新とビルドを実行） |
| `init` | 標準構成の新規アドオンプロジェクトを作成します（`init <name>` / `init .` で現在のディレクトリを初期化） |
| `generate` (`g`) | 初期化済みプロジェクトに `item` / `block` / `entity` / `script` の雛形を追加します |

### `init`

```bash
minecraft-cli init my-addon        # ./my-addon を作成
minecraft-cli init .               # 現在のディレクトリを初期化 (プロジェクト名はフォルダ名)
minecraft-cli init . -i --git      # pnpm install (なければ npm) と git init も実行
```

| オプション | 説明 |
| :--- | :--- |
| `--namespace <ns>` | 識別子の名前空間（省略時はプロジェクト名の snake_case。`package.json` の `minecraftAddon.namespace` に保存） |
| `--description <text>` | manifest の description |
| `--min-engine <x.y.z>` | `min_engine_version`（既定 `1.20.80`） |
| `-b` / `-r` | BP のみ / RP のみ作成 |
| `--no-script` | `src/` と `tsconfig.json` を作成しない |
| `-i, --install` | 生成後に依存をインストール（pnpm 優先） |
| `--git` | `git init` を実行 |
| `--force` | 既存ファイルを上書き（既定では 1 つでも衝突すると何も書き込まず中止） |

### `generate`

```bash
minecraft-cli generate item ruby_sword
minecraft-cli g block ruby_ore --name "Ruby Ore"
minecraft-cli g entity golem
minecraft-cli g script combat --dry-run   # 書き込まず予定のみ表示
```

`item_texture.json` / `terrain_texture.json` / `en_US.lang` は既存内容にマージされ、同じコマンドを再実行しても重複しません。`--namespace` / `--name` / `--dry-run` / `--force` が使えます。


---

## オプション一覧

| オプション | 短縮 | 説明 |
| :--- | :--- | :--- |
| `--bp` | `-b` | Behavior Pack のみを対象にする |
| `--rp` | `-r` | Resource Pack のみを対象にする |
| `--cwd <path>` | `-c` | 対象プロジェクトのディレクトリパス（デフォルト: カレントディレクトリ） |
| `--addon-name <name>` | `-n` | 出力する `.mcaddon` / `.mcpack` のファイル名（省略時は `package.json` やフォルダ名から自動推定） |
| `--skip-build` | `-s` | `pack` 実行時に事前の `version-up` と `build` をスキップする |
| `--major` | - | メジャーバージョンをインクリメント（マイナーとパッチは 0 にリセット） |
| `--minor` | - | マイナーバージョンをインクリメント（パッチは 0 にリセット） |
| `--patch` | - | パッチバージョンをインクリメント（`version-up` のデフォルト） |
| `--help` | `-h` | ヘルプメッセージを表示 |

---

## よく使うコマンド例

### 1. 一括実行（日常的な開発・配布フロー）
```bash
minecraft-cli all
```

### 2. ビルド
```bash
# packs/BP & packs/RP 全体ビルド
minecraft-cli build

# packs/BP のみビルド
minecraft-cli build -b

# packs/RP のみビルド
minecraft-cli build -r
```

### 3. バージョンアップ
```bash
# パッチバージョンを +1 (例: 1.0.44 -> 1.0.45)
minecraft-cli version-up

# マイナーバージョンを +1 (例: 1.0.44 -> 1.1.0)
minecraft-cli version-up --minor

# メジャーバージョンを +1 (例: 1.0.44 -> 2.0.0)
minecraft-cli version-up --major
```

### 4. パッケージング
```bash
# 自動バージョン更新 + ビルド + パッケージ作成 (.mcpack / .mcaddon)
minecraft-cli pack

# 既にビルド済みのファイルから直ちにパッケージを作成 (ビルドをスキップ)
minecraft-cli pack --skip-build

# 出力ファイル名を指定してパッケージング
minecraft-cli pack -n my-custom-addon.mcaddon
```

---

## アドオンの `package.json` 推奨設定

各アドオンの `package.json` には、`minecraft-cli` を呼び出すスクリプトを登録します：

```json
{
  "scripts": {
    "build": "minecraft-cli build",
    "build:bp": "minecraft-cli build -b",
    "build:rp": "minecraft-cli build -r",
    "versionup": "minecraft-cli version-up",
    "versionup:bp": "minecraft-cli version-up -b",
    "versionup:rp": "minecraft-cli version-up -r",
    "versionup:minor": "minecraft-cli version-up --minor",
    "versionup:major": "minecraft-cli version-up --major",
    "pack": "minecraft-cli pack",
    "pack:bp": "minecraft-cli pack -b",
    "pack:rp": "minecraft-cli pack -r",
    "all": "minecraft-cli all"
  }
}
```

---

## 🤖 AI アシスタントへの指示（AI Guidelines）

このディレクトリ内で作業する AI は、以下のルールを厳守してください：
1. **ソースコードの配置**:
   - 新規・変更する TypeScript コードはすべて **`src/`** 配下に配置してください。
   - エントリーポイントは必ず **`src/main.ts`** としてください。
   - `packs/BP/` の中に `scripts/` フォルダを作成・配置してはいけません。
2. **パック静的ファイルの配置**:
   - ビヘイビアーパックの静的アセットは **`packs/BP/`** に配置してください。
   - リソースパックの静的アセットは **`packs/RP/`** に配置してください。
3. **ビルドおよび配布パッケージ作成**:
   - 独自スクリプトを作成せず、必ず `minecraft-cli` コマンドを使用してください。
   - 一括処理: `minecraft-cli all`
   - ビルドのみ: `minecraft-cli build`
   - バージョン更新のみ: `minecraft-cli version-up`
   - パッケージ作成のみ: `minecraft-cli pack --skip-build`
