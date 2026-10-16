# Treasure AI Data Catalog

Treasure AI Studio に GitHub リポジトリを読み込ませて指示すると、Treasure Data 環境の **データカタログ** と、それを読み込む **SKILL** を作成します。作成したカタログ ZIP をこのビューアーで開くと、人が確認しやすい画面で確認できます。

- ビューアー: https://tsukaharakazuki.github.io/treasure-ai-data-catalog/
- 作り方: [docs/TREASURE_AI_STUDIO.md](./docs/TREASURE_AI_STUDIO.md)
- 形式: [docs/CATALOG_FORMAT.md](./docs/CATALOG_FORMAT.md)

## 構成

```text
Treasure AI Studio
  └─ skills/treasure-ai-data-catalog-builder（このリポジトリ）
       ├─ tdx（読み取り専用）で Parent Segment / Workflow / Saved Query / Source / テーブルを収集
       ├─ catalog-cli.mjs で validate → release（リビジョン採番・差分）→ pack
       ├─ <name>-data-catalog-r000N.zip ………… ビューアーで開く
       ├─ <name>-data-catalog SKILL ………………… 誰でも Studio で使える
       └─ MEMORY.md ………………………………………… 作業記録（時系列・担当者の引き継ぎ用）
```

生成物はすべて **`my` 以外の共有フォルダ**（既定は `data-catalog/`）に置きます。Treasure AI Studio の `my` フォルダは本人しかアクセスできず、他のメンバーに共有できないためです。CLI も `my` の中への書き出しをエラーにします。作業は段階を追って担当者をまたいで進むので、各段階の内容・確定事項・要確認事項・次にやることを `MEMORY.md` に時系列で残し、ZIP にも同梱します。

## カタログに含まれるもの

| 要素 | 内容 |
| --- | --- |
| メタデータ | テーブルスキーマ、利用者の言語での論理名（確定/推定/要確認）、説明（1行の粒度）、利用用途、マスク済みサンプルデータ、コード値、ID体系、個人情報区分 |
| データリネージ | テーブルを中心に Source → テーブル → Workflow / Saved Query → テーブル → `customers` / `behavior_*` → Parent Segment → Activation。推定・未解決は点線 |
| ER図 | 結合キー・カーディナリティ・一致率の根拠 |
| サンプルクエリ | テーブルごとの Trino クエリ（`td_interval` によるパーティション絞り込み済み） |
| リビジョン管理 | 更新のたびに `r0001`, `r0002`… を採番。任意の2版の差分（テーブル・カラム・論理名・リネージ・ER・用語・アセット）と CHANGELOG |
| 社内用語・処理事例集 | 用語の定義と、同じ指示のテーブル別の計算（「売上の合計」→ 明細なら `SUM(単価 * 個数)`、ヘッダなら `SUM(注文合計金額)` など） |

## ビューアー

- **概要**: 件数、論理名の付与率、要確認の一覧、読み込み時の警告
- **テーブル**: 物理名・論理名・カラム名で検索。概要 / スキーマ / サンプルデータ / サンプルクエリ / リネージのタブ
- **テーブル探索**: 「統合ID」などの言葉で、全テーブルを横断して一致するカラムを一覧（物理名・論理名・説明・ID体系・テーブル名、スペース区切りで AND）。DB・ID体系・個人情報区分で絞り込み、TSV でコピー
- **データリネージ**: 全体または特定ノード中心（深さ指定）。Workflow・Saved Query を矢印にまとめる表示、種類ごとの表示切替、PNG 出力
- **ER図**: 全体または特定テーブル中心。PK / FK、カーディナリティ
- **用語・処理事例**: 指示ごとのテーブル別の計算式と SQL
- **ID体系**: 会員ID などの体系と、それを持つカラム
- **アセット**: Source / Workflow / Saved Query / Parent Segment
- **リビジョン**: 履歴と、2版を選んだ差分表示

ZIP はブラウザ内でだけ読み込みます。サーバーはなく、TD への接続や API キーの受け渡しもしません。`index.html` の CSP で外部への通信を禁止しています。

## CLI

`skills/treasure-ai-data-catalog-builder/scripts/catalog-cli.mjs`（Node.js 18 以上、依存なし。TD には接続しません）。

```sh
node scripts/catalog-cli.mjs init     data-catalog/catalog --name acme --lang ja --by 山田   # data-catalog/MEMORY.md も作成
node scripts/catalog-cli.mjs validate data-catalog/catalog
node scripts/catalog-cli.mjs release  data-catalog/catalog --note "初版"
node scripts/catalog-cli.mjs diff     data-catalog/catalog --from r0001 --to current
node scripts/catalog-cli.mjs pack     data-catalog/catalog --out data-catalog/acme-data-catalog-r0001.zip   # MEMORY.md を同梱
node scripts/catalog-cli.mjs unpack   acme-data-catalog-r0001.zip data-catalog/catalog                     # MEMORY.md を復元
node scripts/catalog-cli.mjs sample-sql data-catalog/catalog      # 全カラムのマスク付きサンプル取得 SQL（10 行）
node scripts/catalog-cli.mjs import-samples data-catalog/catalog --table db.t --file result.json
node scripts/catalog-cli.mjs relationships data-catalog/catalog   # ID体系から ER 候補と一致率 SQL
node scripts/catalog-cli.mjs skill    data-catalog/catalog --out data-catalog/skills --zip data-catalog/acme-data-catalog-skill.zip
node scripts/catalog-cli.mjs memory   data-catalog/catalog --by 山田 --stage 収集 --status 進行中 --summary "raw_ec を収集" --open "会員IDの体系（EC担当に確認）" --next "ER の一致率を測る"
```

`data-catalog/` は `my` 以外の場所に置きます（パスに `my` フォルダが含まれるとエラー）。`init` / `release` / `pack` / `unpack` / `skill` は `MEMORY.md` に自動で 1 行追記し、`memory` で段階ごとの記録を追記します。

`validate` は、カタログの置き場所（`my` の中でないこと）、形式・相互参照（未定義のID体系やテーブル）・サンプル行数・個人情報のマスク漏れ・API キーや Webhook らしき文字列を検査します。

## サンプル

[`examples/demo-retail-catalog/`](./examples/demo-retail-catalog/) は架空の小売企業（ミナト雑貨）の合成カタログで、2 つのリビジョンを含みます。ビューアーの「サンプルを開く」で表示できます。作り直すときは既存のフォルダを削除してから `node scripts/build-sample.mjs` を実行します。

## 開発

Node.js 22 以降を推奨します。

```sh
npm ci
npm run dev
npm test        # 中核ロジック（読み込み・差分・リネージ・検索・CLI）のテスト
npm run build
```

`main` への push で GitHub Actions がテスト・ビルドし、GitHub Pages に公開します（Settings → Pages の Source は GitHub Actions）。

## 関連

- [Treasure Workflow Visual Editor](https://github.com/tsukaharakazuki/td-workflow-visual-editor) — Workflow 単体のタスク・データの流れを可視化・編集
