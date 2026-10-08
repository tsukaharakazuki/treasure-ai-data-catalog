# Treasure AI Data Catalog 形式 v1

ビューアー（Treasure AI Data Catalog）と `<name>-data-catalog` SKILL が読む、データカタログのファイル形式。すべて UTF-8 の JSON（`CHANGELOG.md` のみ Markdown）。ビューアー側の型定義は `src/types/catalog.ts`。

## ディレクトリ構成

```text
catalog/
├── catalog.json              # 必須。マニフェスト
├── tables/<database>/<table>.json
├── lineage.json              # データリネージ
├── relationships.json        # ER（リレーション）
├── glossary.json             # 用語・ID体系・処理事例・業務ルール
├── assets.json               # Source / Workflow / Saved Query / Parent Segment
├── revisions/
│   ├── index.json            # リビジョン一覧（release が更新）
│   └── r0001.json …          # 各リビジョンのスナップショット（release が作成）
└── CHANGELOG.md              # 変更差分（release が追記）
```

- ZIP は `catalog/` フォルダごと固めてよい（ビューアーは `catalog.json` のある階層をルートとして扱う）。
- `revisions/` と `CHANGELOG.md` は手で書かない。`catalog-cli.mjs release` が作る。
- 不明な値は **キーごと省略** する。空文字や「不明」で埋めない。

## catalog.json

```json
{
  "format": "treasure-ai-data-catalog",
  "version": 1,
  "name": "acme",
  "display_name": "ACME データカタログ",
  "customer": "株式会社ACME",
  "service": "ACME オンラインストア",
  "language": "ja",
  "revision": { "id": "r0001", "number": 1, "generated_at": "2026-10-09T09:00:00+09:00", "generated_by": "Treasure AI Studio", "note": "初版" },
  "td": { "site": "us01", "console_base_url": "https://console.treasuredata.com", "timezone": "Asia/Tokyo" },
  "scope": {
    "databases": ["raw_ec"],
    "parent_segments": ["ACME会員"],
    "workflow_projects": ["ec_daily"],
    "saved_queries": ["daily_sales_summary"],
    "sources": ["shopify_daily_import"],
    "inputs": ["https://console.treasuredata.com/..."]
  },
  "privacy": { "sample_rows_max": 10, "masking_policy": "氏名・メール・電話・住所・生年月日・端末ID・自由記述はマスクする" },
  "description": "任意の説明"
}
```

| フィールド | 必須 | 説明 |
| --- | --- | --- |
| `format` | ○ | 固定値 `treasure-ai-data-catalog` |
| `version` | ○ | 数値の `1` |
| `name` | ○ | 英小文字・数字・ハイフンのスラッグ。SKILL 名 `<name>-data-catalog` になる |
| `language` | ○ | 論理名・説明の言語（BCP 47） |
| `revision` | ○ | `release` が更新する。初期値は `{ "id": "draft", "number": 0 }` |
| `scope` | | 収集の起点。更新モードはこの範囲を再収集する |
| `privacy.sample_rows_max` | | サンプル行数（既定 10。取得行数もこの値）。validate が検査する |

## tables/&lt;database&gt;/&lt;table&gt;.json

```json
{
  "database": "raw_ec",
  "name": "shopify_orders",
  "logical_name": "EC注文（Shopify）",
  "kind": "source",
  "description": "Shopify から日次で取り込む EC 注文ヘッダ。1行 = 1注文。キャンセル注文も含む。",
  "usage": ["EC売上の日次集計", "キャンセル率のモニタリング"],
  "tags": ["EC", "注文"],
  "update_frequency": "日次 04:00 JST",
  "row_count": 1284503,
  "last_updated_unixtime": 1791486600,
  "console_url": "https://console.treasuredata.com/...",
  "primary_key": ["order_id"],
  "columns": [
    {
      "name": "customer_id",
      "type": "varchar",
      "logical_name": "EC会員番号",
      "logical_name_status": "confirmed",
      "description": "Shopify 側の会員番号。統合会員IDとは別体系。",
      "pii": "identifier",
      "id_system": "ec_customer_id",
      "stats": { "null_ratio": 0.08, "min_length": 8, "max_length": 8, "pattern": "\"C\" + 7桁の数字" }
    },
    { "name": "status", "type": "varchar", "logical_name": "注文ステータス", "values": { "paid": "支払済", "cancelled": "キャンセル" } },
    { "name": "time", "type": "bigint", "logical_name": "データ取込時刻（UNIX秒）", "is_partition_key": true }
  ],
  "samples": {
    "captured_at": "2026-10-08",
    "masked_columns": ["customer_id"],
    "rows": [{ "customer_id": "C0****1", "status": "paid", "time": 1759839243 }]
  },
  "sample_queries": [
    { "title": "直近7日の日別売上", "engine": "trino", "sql": "SELECT ... WHERE td_interval(time, '-7d', 'JST') ..." }
  ],
  "notes": "任意の補足"
}
```

| フィールド | 説明 |
| --- | --- |
| `kind` | `source`（取込）/ `derived`（加工）/ `mart`（集計）/ `master` / `segment_output`（Parent Segment 出力）/ `temporary` |
| `description` | **1行が何を表すか（粒度）** を必ず含める |
| `row_count` | `SELECT COUNT(*)` の結果 |
| `last_updated_unixtime` | `MAX(time)`（UNIX 秒）。ビューアーは `td.timezone`（既定 `Asia/Tokyo`）で `yyyy-MM-dd HH:mm:ss` 表示。`time` 列が無いテーブルは省略 |
| `usage` | 利用用途。下流の Workflow / Parent Segment / Saved Query から読み取る |
| `columns[].logical_name_status` | `confirmed`（一次情報・ユーザー確認済み）/ `inferred`（推定）/ `needs_review`（要確認） |
| `columns[].pii` | `none` / `identifier`（会員ID・Cookie ID など）/ `personal`（メール・氏名・電話・住所）/ `sensitive`（生年月日・健康・決済など） |
| `columns[].id_system` | `glossary.json` の `id_systems[].id` |
| `columns[].values` | コード値の定義（`{"1": "男性"}`） |
| `samples.rows` | `pii` が `personal` / `sensitive` の値はマスク必須（`*` または `[masked]` を含むこと）。validate が検査する |

## lineage.json

```json
{
  "nodes": [
    { "id": "source:shopify", "type": "source", "label": "Shopify（日次インポート）", "ref": "shopify" },
    { "id": "table:raw_ec.shopify_orders", "type": "table", "label": "EC注文", "ref": "raw_ec.shopify_orders" },
    { "id": "workflow:ec_daily.unify_orders", "type": "workflow", "label": "ec_daily.unify_orders", "ref": "ec_daily.unify_orders" }
  ],
  "edges": [
    { "from": "source:shopify", "to": "table:raw_ec.shopify_orders", "type": "import", "confidence": "exact" },
    { "from": "table:raw_ec.shopify_orders", "to": "workflow:ec_daily.unify_orders", "type": "reads", "confidence": "exact" }
  ]
}
```

ノード ID の規約（ビューアーのリンクと差分に使う）:

| type | id | ref |
| --- | --- | --- |
| `table` | `table:<db>.<table>` | `<db>.<table>` |
| `source` | `source:<assets.sources[].id>` | 同 id |
| `workflow` | `workflow:<project>.<workflow>`（= `assets.workflows[].id`） | 同 |
| `saved_query` | `saved_query:<assets.saved_queries[].id>` | 同 |
| `parent_segment` | `parent_segment:<assets.parent_segments[].id>` | 同 |
| `segment` / `activation` / `external` | `<type>:<任意のid>` | 任意 |

- 向きは常にデータの流れる方向（Source → テーブル → Workflow → テーブル → `cdp_audience_<id>.customers` / `behavior_*` → Parent Segment → Activation）。Parent Segment の元テーブルは、出力テーブル（`customers` / `behavior_*`）を経由して Parent Segment につなぐ。
- Workflow / Saved Query は「読むテーブル → 処理」「処理 → 書くテーブル」の 2 本で表す。ビューアーはこれを「テーブル → テーブル」にまとめて表示できる。
- `type`: `import` / `reads` / `writes` / `transform` / `feeds` / `activates`
- `confidence`: `exact`（定義から確定）/ `inferred`（推定）/ `unresolved`（`${...}` 未解決など）。`note` に根拠を書く。

## relationships.json

```json
{
  "relationships": [
    {
      "from": { "table": "raw_ec.shopify_order_items", "columns": ["order_id"] },
      "to": { "table": "raw_ec.shopify_orders", "columns": ["order_id"] },
      "cardinality": "many-to-one",
      "confidence": "confirmed",
      "evidence": "一致率 100%（直近30日）",
      "id_system": "ec_customer_id"
    }
  ]
}
```

- `from` が参照する側（子）、`to` が参照される側（親）。複合キーは `columns` を同じ順で並べる。
- `cardinality`: `one-to-one` / `one-to-many` / `many-to-one` / `many-to-many`（from から見た向き）
- `confidence`: `confirmed`（JOIN 定義・一致率で裏付け）/ `inferred` / `needs_review`

## glossary.json

```json
{
  "terms": [
    { "term": "売上", "aliases": ["売り上げ", "revenue"], "category": "KPI", "definition": "税込・キャンセル除外の購買金額", "related_tables": ["ec_dwh.orders_unified"] }
  ],
  "id_systems": [
    { "id": "member_id", "name": "統合会員ID", "pattern": "^[0-9]{10}$", "length": 10, "example_masked": "10****21", "status": "confirmed",
      "columns": ["raw_ec.crm_members.member_id"], "description": "全チャネル共通の会員ID" }
  ],
  "recipes": [
    {
      "id": "sales_total",
      "instruction": "売上の合計を出して",
      "aliases": ["売上合計", "売上金額"],
      "term": "売上",
      "description": "テーブルごとに計算式が違う",
      "variants": [
        { "table": "raw_ec.shopify_order_items", "expression": "SUM(unit_price * quantity)", "conditions": "キャンセル注文を除外", "notes": "送料を含まない" },
        { "table": "raw_ec.shopify_orders", "expression": "SUM(order_total)", "conditions": "status <> 'cancelled'", "sql": "SELECT ..." }
      ]
    }
  ],
  "rules": [
    { "title": "キャンセルは売上に含めない", "description": "...", "applies_to": ["raw_ec.shopify_orders"] }
  ]
}
```

- `recipes[].id` は英小文字のスラッグで、リビジョンをまたいで変えない（差分のキー）。
- 同じ指示でもテーブルで計算が違う場合、`variants` を分けて `expression` / `conditions` / `notes` で違いを明示する。使ってはいけない計算は `expression` を `（使用不可）...` とし、理由を `notes` に書く。
- 既定として勧める variant は `notes` に「標準」と書く。

## assets.json

```json
{
  "sources": [{ "id": "shopify", "name": "shopify_daily_import", "connector_type": "shopify", "schedule": "0 4 * * *", "mode": "append", "target_tables": ["raw_ec.shopify_orders"], "console_url": "https://..." }],
  "workflows": [{ "id": "ec_daily.unify_orders", "project": "ec_daily", "workflow": "unify_orders", "schedule": "daily>: 06:00:00", "reads": ["raw_ec.shopify_orders"], "writes": ["ec_dwh.orders_unified"] }],
  "saved_queries": [{ "id": "daily_sales_summary", "name": "daily_sales_summary", "schedule": "30 7 * * *", "database": "ec_dwh", "engine": "trino", "sql": "SELECT ...", "reads": [], "writes": [], "result_export": "td テーブル ec_dwh.daily_sales_summary" }],
  "parent_segments": [{ "id": "1001", "name": "ACME会員", "master_table": "ec_dwh.member_master", "attribute_tables": [], "behavior_tables": [], "output_database": "cdp_audience_1001" }]
}
```

- `result_export` / Source の設定に接続文字列・認証情報・URL のクエリ文字列を **入れない**。出力先の種類とテーブル名だけを書く。

## プライバシー境界

- 入れてよい: 名前・型・説明・統計（NULL率・桁数・形式・おおよその種類数）・コード値の定義・マスク済みサンプル。
- 入れない: 生の個人情報、API キー、トークン、Webhook URL、パスワード、接続文字列、クエリ結果の全件。
- `catalog-cli.mjs validate` は、マスク漏れ・行数超過・認証情報らしき文字列を error にする。
