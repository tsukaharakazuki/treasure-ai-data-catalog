# 変更履歴

## r0002 — 2026-10-01 日次売上サマリ追加・性別コード確定

比較元: r0001

- テーブル: 追加 1 / 削除 0 / 変更 2
- カラム: 追加 1 / 削除 0 / 変更 1
- リネージ 3 / ER 0 / 用語・処理事例・ID体系 2 / アセット 1
- [追加] テーブル `ec_dwh.daily_sales_summary`（日次売上サマリ）
- [変更] テーブル `raw_ec.crm_members`（CRM会員）
  - [変更] カラム `gender_code` — logical_name: 性別？ → 性別コード; description: 値は 1/2/9。定義を確認中。 → （なし）; values: （なし） → {"1":"男性","2":"女性","9":"回答しない"}
- [変更] テーブル `raw_ec.shopify_orders`（EC注文（Shopify））
  - [追加] カラム `coupon_code`
- [追加] リネージ: saved_query:daily_sales_summary → table:ec_dwh.daily_sales_summary
- [追加] リネージ: table:ec_dwh.daily_sales_summary → external:bi_dashboard
- [追加] リネージ: table:ec_dwh.orders_unified → saved_query:daily_sales_summary
- [追加] 処理事例: 購入者数を出して
- [変更] 処理事例: 売上の合計を出して
- [追加] アセット: Saved Query: daily_sales_summary

## r0001 — 2026-09-01 初版

比較元: （初版）

- テーブル: 追加 10 / 削除 0 / 変更 0
- カラム: 追加 0 / 削除 0 / 変更 0
- リネージ 19 / ER 9 / 用語・処理事例・ID体系 10 / アセット 7
- [追加] テーブル `cdp_audience_1001.behavior_orders_unified`（購買ビヘイビア（ミナト会員））
- [追加] テーブル `cdp_audience_1001.behavior_web_pageviews`（Web閲覧ビヘイビア（ミナト会員））
- [追加] テーブル `cdp_audience_1001.customers`（パーセグ顧客（ミナト会員））
- [追加] テーブル `ec_dwh.member_master`（会員マスタ）
- [追加] テーブル `ec_dwh.orders_unified`（統合購買）
- [追加] テーブル `raw_ec.crm_members`（CRM会員）
- [追加] テーブル `raw_ec.pos_transactions`（店舗POS取引）
- [追加] テーブル `raw_ec.shopify_order_items`（EC注文明細（Shopify））
- [追加] テーブル `raw_ec.shopify_orders`（EC注文（Shopify））
- [追加] テーブル `raw_ec.web_pageviews`（Web閲覧ログ）
- [追加] リネージ: parent_segment:1001 → activation:meta_custom_audience
- [追加] リネージ: source:pos_s3 → table:raw_ec.pos_transactions
- [追加] リネージ: source:salesforce → table:raw_ec.crm_members
- [追加] リネージ: source:shopify → table:raw_ec.shopify_order_items
- [追加] リネージ: source:shopify → table:raw_ec.shopify_orders
- [追加] リネージ: source:td_js_sdk → table:raw_ec.web_pageviews
- [追加] リネージ: table:cdp_audience_1001.behavior_orders_unified → parent_segment:1001
- [追加] リネージ: table:cdp_audience_1001.behavior_web_pageviews → parent_segment:1001
- [追加] リネージ: table:cdp_audience_1001.customers → parent_segment:1001
- [追加] リネージ: table:ec_dwh.member_master → table:cdp_audience_1001.customers
- [追加] リネージ: table:ec_dwh.orders_unified → table:cdp_audience_1001.behavior_orders_unified
- [追加] リネージ: table:ec_dwh.orders_unified → workflow:ec_daily.build_member_master
- [追加] リネージ: table:raw_ec.crm_members → workflow:ec_daily.build_member_master
- [追加] リネージ: table:raw_ec.crm_members → workflow:ec_daily.unify_orders
- [追加] リネージ: table:raw_ec.pos_transactions → workflow:ec_daily.unify_orders
- [追加] リネージ: table:raw_ec.shopify_orders → workflow:ec_daily.unify_orders
- [追加] リネージ: table:raw_ec.web_pageviews → table:cdp_audience_1001.behavior_web_pageviews
- [追加] リネージ: workflow:ec_daily.build_member_master → table:ec_dwh.member_master
- [追加] リネージ: workflow:ec_daily.unify_orders → table:ec_dwh.orders_unified
- [追加] ER: cdp_audience_1001.behavior_orders_unified(cdp_customer_id) -> cdp_audience_1001.customers(cdp_customer_id)
- [追加] ER: cdp_audience_1001.behavior_web_pageviews(cdp_customer_id) -> cdp_audience_1001.customers(cdp_customer_id)
- [追加] ER: cdp_audience_1001.customers(member_id) -> ec_dwh.member_master(member_id)
- [追加] ER: ec_dwh.member_master(member_id) -> raw_ec.crm_members(member_id)
- [追加] ER: ec_dwh.orders_unified(member_id) -> ec_dwh.member_master(member_id)
- [追加] ER: raw_ec.pos_transactions(member_card_no) -> raw_ec.crm_members(card_no)
- [追加] ER: raw_ec.shopify_order_items(order_id) -> raw_ec.shopify_orders(order_id)
- [追加] ER: raw_ec.shopify_orders(customer_id) -> raw_ec.crm_members(ec_customer_id)
- [追加] ER: raw_ec.web_pageviews(member_id) -> raw_ec.crm_members(member_id)
- [追加] 用語: アウトレット店
- [追加] 用語: アクティブ会員
- [追加] 用語: 売上
- [追加] 用語: 購入者
- [追加] 処理事例: 一番大きい注文はいくら？
- [追加] 処理事例: 売上の合計を出して
- [追加] ID体系: EC会員番号
- [追加] ID体系: 統合会員ID
- [追加] ID体系: ポイントカード番号
- [追加] ID体系: ブラウザID
- [追加] アセット: Parent Segment: ミナト会員
- [追加] アセット: Source: pos_s3_import
- [追加] アセット: Source: sfdc_members
- [追加] アセット: Source: shopify_daily_import
- [追加] アセット: Source: TD JS SDK（minato-zakka.example）
- [追加] アセット: Workflow: ec_daily.build_member_master
- [追加] アセット: Workflow: ec_daily.unify_orders

