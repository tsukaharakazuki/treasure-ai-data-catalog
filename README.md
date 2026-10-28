# Treasure AI Data Catalog

Treasure AI Studio に GitHub リポジトリを読み込ませて指示すると、Treasure Data 環境の **データカタログ** と、それを読み込む **SKILL** を作成します。作成したカタログ ZIP をこのビューアーで開くと、人が確認しやすい画面で確認できます。

- ビューアー: https://tsukaharakazuki.github.io/treasure-ai-data-catalog/
- 作り方: [docs/TREASURE_AI_STUDIO.md](./docs/TREASURE_AI_STUDIO.md)
- 形式: [docs/CATALOG_FORMAT.md](./docs/CATALOG_FORMAT.md)
- セキュリティ修正と検証: [2026-10-28の確認記録](./docs/SECURITY_REVIEW_2026-10-28.md)

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
| メタデータ | テーブルスキーマ、利用者の言語での論理名（確定/推定/要確認）、説明（1行の粒度）、利用用途、仕様に基づくコード定義、ID体系、個人情報区分、集計統計（実データの行サンプルは含めない） |
| データリネージ | テーブルを中心に Source → テーブル → Workflow / Saved Query → テーブル → `customers` / `behavior_*` → Parent Segment → Activation。推定・未解決は点線 |
| ER図 | 結合キー・カーディナリティ・一致率の根拠 |
| サンプルクエリ | テーブルごとの Trino SQL の例（`td_interval` による期間指定。実行結果や行サンプルではない） |
| リビジョン管理 | 更新のたびに `r0001`, `r0002`… を採番。任意の2版の差分（テーブル・カラム・論理名・リネージ・ER・用語・アセット）と CHANGELOG |
| 社内用語・処理事例集 | 用語の定義と、同じ指示のテーブル別の計算（「売上の合計」→ 明細なら `SUM(単価 * 個数)`、ヘッダなら `SUM(注文合計金額)` など） |

## ビューアー

- **概要**: 件数、論理名の付与率、要確認の一覧、読み込み時の警告
- **テーブル**: 物理名・論理名・カラム名で検索。概要 / スキーマ / サンプルクエリ / リネージのタブ（行サンプルの表示機能はありません）
- **テーブル探索**: 「統合ID」などの言葉で、全テーブルを横断して一致するカラムを一覧（物理名・論理名・説明・ID体系・テーブル名、スペース区切りで AND）。DB・ID体系・個人情報区分で絞り込み、TSV でコピー
- **データリネージ**: 全体または特定ノード中心（深さ指定）。Workflow・Saved Query を矢印にまとめる表示、種類ごとの表示切替、PNG 出力
- **ER図**: 全体または特定テーブル中心。PK / FK、カーディナリティ
- **用語・処理事例**: 指示ごとのテーブル別の計算式と SQL
- **ID体系**: 会員ID などの体系と、それを持つカラム
- **アセット**: Source / Workflow / Saved Query / Parent Segment
- **リビジョン**: 履歴と、2版を選んだ差分表示

ZIP はブラウザ内でだけ読み込みます。サーバーはなく、TD への接続や API キーの受け渡しもしません。`index.html` の CSP で外部への通信を禁止しています。

## CLI

`skills/treasure-ai-data-catalog-builder/scripts/catalog-cli.mjs`（依存なし。TD には接続しません）。Node.js は **24.22.1 以上の 24 LTS**、または **26.12.1 以上の 26 LTS** を使い、サポート中の系列のセキュリティ更新を適用してください。

```sh
node scripts/catalog-cli.mjs init     data-catalog/catalog --name acme --lang ja --by 山田   # data-catalog/MEMORY.md も作成
node scripts/catalog-cli.mjs validate data-catalog/catalog
node scripts/catalog-cli.mjs release  data-catalog/catalog --note "初版"
node scripts/catalog-cli.mjs diff     data-catalog/catalog --from r0001 --to current
node scripts/catalog-cli.mjs pack     data-catalog/catalog --out data-catalog/acme-data-catalog-r0001.zip   # MEMORY.md を同梱
node scripts/catalog-cli.mjs unpack   acme-data-catalog-r0001.zip restored-data-catalog/catalog            # 新しい展開先に MEMORY.md を復元
node scripts/catalog-cli.mjs relationships data-catalog/catalog   # ID体系から ER 候補と集計のみの一致率 SQL
node scripts/catalog-cli.mjs skill    data-catalog/catalog --out data-catalog/skills --zip data-catalog/acme-data-catalog-skill.zip   # 生成する SKILL は新しい空のディレクトリへ
node scripts/catalog-cli.mjs memory   data-catalog/catalog --by 山田 --stage 収集 --status 進行中 --summary "raw_ec を収集" --open "会員IDの体系（EC担当に確認）" --next "ER の一致率を測る"
```

`data-catalog/` は `my` 以外の場所に置きます（パスに `my` フォルダが含まれるとエラー）。`init` / `release` / `pack` / `unpack` / `skill` は `MEMORY.md` に自動で 1 行追記し、`memory` で段階ごとの記録を追記します。

`validate` は、カタログの置き場所（`my` の中でないこと）、形式・相互参照（未定義のID体系やテーブル）、禁止された旧 `samples` / `example_masked` フィールドと非0の `sample_rows_max`、API キーや Webhook らしき文字列を検査します。現在のテーブルだけでなくリビジョンのスナップショットにある非 null の `samples` もエラーです。`release` / `pack` / `skill` は検証エラーのあるカタログを出力せず、`--force` でも回避できません。`unpack` は展開前に ZIP を検査し、旧行サンプルを含む ZIP や出力先の既存ファイルを上書きする展開を拒否します。`skill` の生成先には新しい空のディレクトリを使います。

## 実データを収集しないポリシー

- **実データの行サンプルは、マスク・ハッシュ化・部分伏字の有無にかかわらず取得・保存・同梱しません。** 個人情報区分が `none` でも例外ではありません。サンプルを含めるかどうかは質問せず、旧サンプル取得・取込機能も提供しません。
- 許可するのはスキーマ・仕様書やユーザー確認に基づく定義と、行数・NULL率・長さ・種類数・一致率などの**集計値だけ**です。ID の実例、データ上のコード値一覧、DISTINCT 値の列挙、個票のダンプで意味を推測しません。SQL の例（`sample_queries`）を行サンプル取得のために実行しません。
- 旧カタログの `samples` は現在のテーブル・過去のスナップショットとも禁止です。ビューアーは旧サンプルを破棄して表示しませんが、**元の ZIP を消去・無害化するわけではありません**。配布・更新には、元の保持者が旧サンプルと転記済みの行データを取り除いたカタログを用意して再検証してください。
- 検証は補助的な防御です。説明文・SQL・MEMORY.md などへ転記された実データや秘密情報をすべて検出する保証はありません。作成時から記録しないことが前提です。

## 合成デモカタログ

[`examples/demo-retail-catalog/`](./examples/demo-retail-catalog/) は架空の小売企業（ミナト雑貨）のスキーマ・定義・SQL 例を使った合成デモカタログで、2 つのリビジョンを含みます。実データの行サンプルではありません。ビューアーのデモを開く操作で表示できます。作り直すときは既存のフォルダを削除してから `node scripts/build-sample.mjs` を実行します。

## 開発

CLI と同じく、Node.js 24.22.1 以上の 24 LTS または 26.12.1 以上の 26 LTS を使います。最低バージョンを満たしていても、セキュリティ更新を継続適用してください。

```sh
npm ci --ignore-scripts
npm run dev
npm test        # 中核ロジック（読み込み・差分・リネージ・検索・CLI）のテスト
npm run build
```

`main` への push で GitHub Actions がテスト・ビルドし、GitHub Pages に公開します（Settings → Pages の Source は GitHub Actions）。

## 関連

- [Treasure Workflow Visual Editor](https://github.com/tsukaharakazuki/td-workflow-visual-editor) — Workflow 単体のタスク・データの流れを可視化・編集
