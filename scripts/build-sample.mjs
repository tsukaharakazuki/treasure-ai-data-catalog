#!/usr/bin/env node
// Builds the synthetic sample catalog with two released revisions and packs it
// for the viewer's 「サンプルを開く」 button. Every company, person and value here
// is fictional.
//
//   node scripts/build-sample.mjs [--out examples/demo-retail-catalog]
//
// The output directory must not exist yet; this script never deletes files.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { main, tablePath } from '../skills/treasure-ai-data-catalog-builder/scripts/catalog-cli.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const outFlag = process.argv.indexOf('--out')
const OUT = resolve(outFlag > 0 ? process.argv[outFlag + 1] : join(ROOT, 'examples/demo-retail-catalog'))
const CONSOLE = 'https://console.treasuredata.com'

if (existsSync(OUT)) {
  console.error(`${OUT} は既に存在します。作り直す場合は手動で削除してから実行してください。`)
  process.exit(1)
}

const write = (path, value) => {
  mkdirSync(join(OUT, path, '..'), { recursive: true })
  writeFileSync(join(OUT, path), `${JSON.stringify(value, null, 2)}\n`)
}

const col = (name, type, logical, extra = {}) => ({ name, type, logical_name: logical, logical_name_status: 'confirmed', ...extra })
const timeCol = () => col('time', 'bigint', 'データ取込時刻（UNIX秒）', { description: 'TD のパーティションキー。期間指定は td_interval(time, ...) を使う。', is_partition_key: true })

function tables(revision) {
  const shopifyOrders = {
    database: 'raw_ec', name: 'shopify_orders', logical_name: 'EC注文（Shopify）', kind: 'source',
    description: 'Shopify から日次で取り込む EC 注文ヘッダ。1行 = 1注文。キャンセル注文も含む。',
    usage: ['EC売上の日次集計', '注文単位の購買分析', 'キャンセル率のモニタリング'],
    tags: ['EC', '注文', 'Shopify'], update_frequency: '日次 04:00 JST',
    row_count: 1284503, last_updated_unixtime: 1791486600, primary_key: ['order_id'],
    console_url: `${CONSOLE}/app/databases/raw_ec/tables/shopify_orders`,
    columns: [
      col('order_id', 'varchar', '注文ID', { description: 'Shopify の注文番号（#付きを除去済み）', is_primary_key: true, pii: 'none' }),
      col('customer_id', 'varchar', 'EC会員番号', { description: 'Shopify 側の会員番号。統合会員IDとは別体系。', id_system: 'ec_customer_id', pii: 'identifier', stats: { null_ratio: 0.08, min_length: 8, max_length: 8, pattern: '"C" + 7桁の数字' } }),
      col('order_total', 'double', '注文合計金額（税込）', { description: '送料・割引適用後の税込合計。明細の合計とは一致しないことがある。' }),
      col('status', 'varchar', '注文ステータス', { values: { paid: '支払済', fulfilled: '出荷済', cancelled: 'キャンセル', refunded: '返金済' } }),
      col('ordered_at', 'varchar', '注文日時（JST文字列）', { description: 'yyyy-MM-dd HH:mm:ss（JST）' }),
      ...(revision >= 2 ? [col('coupon_code', 'varchar', 'クーポンコード', { description: '注文に適用されたクーポン。未使用は NULL。' })] : []),
      timeCol(),
    ],
    samples: {
      captured_at: '2026-10-08', masked_columns: ['customer_id'],
      rows: [
        { order_id: '100245', customer_id: 'C00****1', order_total: 5980, status: 'fulfilled', ordered_at: '2026-10-07 21:14:03', time: 1759839243 },
        { order_id: '100246', customer_id: null, order_total: 2200, status: 'paid', ordered_at: '2026-10-07 21:20:41', time: 1759839641 },
        { order_id: '100247', customer_id: 'C01****8', order_total: 12800, status: 'cancelled', ordered_at: '2026-10-07 22:02:17', time: 1759842137 },
      ],
    },
    sample_queries: [
      { title: '直近7日の日別EC売上（キャンセル除外）', engine: 'trino', sql: "SELECT substr(ordered_at, 1, 10) AS order_date,\n       SUM(order_total) AS sales\nFROM raw_ec.shopify_orders\nWHERE td_interval(time, '-7d', 'JST')\n  AND status NOT IN ('cancelled', 'refunded')\nGROUP BY 1\nORDER BY 1" },
      { title: 'ステータス別の注文件数（今月）', engine: 'trino', sql: "SELECT status, COUNT(*) AS orders\nFROM raw_ec.shopify_orders\nWHERE td_interval(time, '0M', 'JST')\nGROUP BY 1\nORDER BY 2 DESC" },
    ],
  }
  const orderItems = {
    database: 'raw_ec', name: 'shopify_order_items', logical_name: 'EC注文明細（Shopify）', kind: 'source',
    description: 'EC 注文の明細。1行 = 1注文 × 1SKU。単価×数量から値引きを引くと明細金額になる。',
    usage: ['商品別売上', 'カテゴリ別の併売分析'], tags: ['EC', '注文', '商品'], update_frequency: '日次 04:00 JST',
    row_count: 3920114, last_updated_unixtime: 1791486600, primary_key: ['order_id', 'line_no'],
    columns: [
      col('order_id', 'varchar', '注文ID', { is_primary_key: true }),
      col('line_no', 'int', '明細番号', { is_primary_key: true }),
      col('sku', 'varchar', '商品SKU'),
      col('unit_price', 'double', '販売単価（税込）'),
      col('quantity', 'int', '数量'),
      col('discount_amount', 'double', '値引額', { description: '明細単位の値引額（税込）。' }),
      timeCol(),
    ],
    samples: { captured_at: '2026-10-08', rows: [
      { order_id: '100245', line_no: 1, sku: 'MUG-0012', unit_price: 1980, quantity: 2, discount_amount: 0, time: 1759839243 },
      { order_id: '100245', line_no: 2, sku: 'TWL-0301', unit_price: 2020, quantity: 1, discount_amount: 0, time: 1759839243 },
    ] },
    sample_queries: [
      { title: 'SKU別売上 TOP20（直近30日）', engine: 'trino', sql: "SELECT i.sku, SUM(i.unit_price * i.quantity - i.discount_amount) AS sales\nFROM raw_ec.shopify_order_items i\nJOIN raw_ec.shopify_orders o ON o.order_id = i.order_id\nWHERE td_interval(i.time, '-30d', 'JST')\n  AND o.status NOT IN ('cancelled', 'refunded')\nGROUP BY 1\nORDER BY 2 DESC\nLIMIT 20" },
    ],
  }
  const pos = {
    database: 'raw_ec', name: 'pos_transactions', logical_name: '店舗POS取引', kind: 'source',
    description: '全店舗の POS レシート。S3 経由で日次取込。1行 = 1レシート。',
    usage: ['店舗売上の集計', 'ポイントカード会員の来店分析'], tags: ['店舗', 'POS'], update_frequency: '日次 05:00 JST',
    row_count: 8820331, last_updated_unixtime: 1791489900, primary_key: ['receipt_no'],
    columns: [
      col('receipt_no', 'varchar', 'レシート番号', { is_primary_key: true }),
      col('store_code', 'varchar', '店舗コード', { description: '4桁。先頭が 9 の店舗はアウトレット。' }),
      col('member_card_no', 'varchar', 'ポイントカード番号', { id_system: 'point_card_no', pii: 'identifier', stats: { null_ratio: 0.41, min_length: 13, max_length: 13, pattern: '"29" で始まる13桁の数字' } }),
      col('amount', 'bigint', 'レシート合計金額（税込）'),
      col('txn_at', 'varchar', '取引日時（JST文字列）'),
      timeCol(),
    ],
    samples: { captured_at: '2026-10-08', masked_columns: ['member_card_no'], rows: [
      { receipt_no: '0012-20261007-0042', store_code: '0012', member_card_no: '29**********3', amount: 3480, txn_at: '2026-10-07 13:42:10', time: 1759812130 },
      { receipt_no: '0012-20261007-0043', store_code: '0012', member_card_no: null, amount: 880, txn_at: '2026-10-07 13:45:55', time: 1759812355 },
    ] },
    sample_queries: [
      { title: '店舗別売上（前日）', engine: 'trino', sql: "SELECT store_code, SUM(amount) AS sales, COUNT(*) AS receipts\nFROM raw_ec.pos_transactions\nWHERE td_interval(time, '-1d', 'JST')\nGROUP BY 1\nORDER BY 2 DESC" },
    ],
  }
  const crm = {
    database: 'raw_ec', name: 'crm_members', logical_name: 'CRM会員', kind: 'source',
    description: 'Salesforce の会員オブジェクト。統合会員ID・EC会員番号・ポイントカード番号の対応表を兼ねる。',
    usage: ['ID統合の起点', '会員属性の参照'], tags: ['会員', 'CRM', 'ID'], update_frequency: '日次 03:00 JST',
    row_count: 412280, last_updated_unixtime: 1791482400, primary_key: ['member_id'],
    columns: [
      col('member_id', 'varchar', '統合会員ID', { id_system: 'member_id', is_primary_key: true, pii: 'identifier', stats: { null_ratio: 0, min_length: 10, max_length: 10, pattern: '10桁の数字' } }),
      col('ec_customer_id', 'varchar', 'EC会員番号', { id_system: 'ec_customer_id', pii: 'identifier' }),
      col('card_no', 'varchar', 'ポイントカード番号', { id_system: 'point_card_no', pii: 'identifier' }),
      col('email', 'varchar', 'メールアドレス', { pii: 'personal' }),
      col('birth_date', 'varchar', '生年月日', { pii: 'sensitive' }),
      revision >= 2
        ? col('gender_code', 'varchar', '性別コード', { values: { 1: '男性', 2: '女性', 9: '回答しない' } })
        : col('gender_code', 'varchar', '性別？', { logical_name_status: 'needs_review', description: '値は 1/2/9。定義を確認中。' }),
      col('pref', 'varchar', '都道府県'),
      col('registered_at', 'varchar', '会員登録日'),
      timeCol(),
    ],
    samples: { captured_at: '2026-10-08', masked_columns: ['member_id', 'ec_customer_id', 'card_no', 'email', 'birth_date'], rows: [
      { member_id: '10****0021', ec_customer_id: 'C00****1', card_no: '29**********3', email: 't***@example.com', birth_date: '19**-**-**', gender_code: '2', pref: '東京都', registered_at: '2019-04-12', time: 1759777200 },
    ] },
    sample_queries: [
      { title: 'ID 紐付け状況', engine: 'trino', sql: 'SELECT COUNT(*) AS members,\n       COUNT(ec_customer_id) AS with_ec,\n       COUNT(card_no) AS with_card\nFROM raw_ec.crm_members' },
    ],
  }
  const web = {
    database: 'raw_ec', name: 'web_pageviews', logical_name: 'Web閲覧ログ', kind: 'source',
    description: 'TD JS SDK で収集した EC サイトのページビュー。ログイン時のみ member_id が入る。',
    usage: ['閲覧行動のセグメント', 'カゴ落ち分析'], tags: ['Web', '行動ログ'], update_frequency: 'ストリーミング',
    columns: [
      col('td_client_id', 'varchar', 'ブラウザID（TD Client ID）', { id_system: 'td_client_id', pii: 'identifier' }),
      col('member_id', 'varchar', '統合会員ID', { id_system: 'member_id', pii: 'identifier' }),
      col('td_url', 'varchar', 'ページURL'),
      col('td_title', 'varchar', 'ページタイトル'),
      timeCol(),
    ],
    sample_queries: [
      { title: '日別UU（直近14日）', engine: 'trino', sql: "SELECT td_time_string(time, 'd!', 'JST') AS day,\n       approx_distinct(td_client_id) AS uu\nFROM raw_ec.web_pageviews\nWHERE td_interval(time, '-14d', 'JST')\nGROUP BY 1\nORDER BY 1" },
    ],
  }
  const unified = {
    database: 'ec_dwh', name: 'orders_unified', logical_name: '統合購買', kind: 'derived',
    description: 'EC 注文と店舗 POS を統合会員IDで束ねた購買テーブル。キャンセル・返金は除外済み。',
    usage: ['チャネル横断の売上・購買者数', 'パーセグの購買ビヘイビア'], tags: ['購買', '統合'], update_frequency: '日次 06:00 JST',
    primary_key: ['order_key'],
    columns: [
      col('order_key', 'varchar', '統合注文キー', { description: '"ec:" + 注文ID または "store:" + レシート番号', is_primary_key: true }),
      col('member_id', 'varchar', '統合会員ID', { id_system: 'member_id', pii: 'identifier', description: '紐付けできない購買は NULL。' }),
      col('channel', 'varchar', '購買チャネル', { values: { ec: 'EC', store: '店舗' } }),
      col('order_amount', 'double', '購買金額（税込）'),
      col('order_date', 'varchar', '購買日（JST）'),
      timeCol(),
    ],
    sample_queries: [
      { title: 'チャネル別売上と購買者数（今月）', engine: 'trino', sql: "SELECT channel,\n       SUM(order_amount) AS sales,\n       COUNT(DISTINCT member_id) AS buyers\nFROM ec_dwh.orders_unified\nWHERE td_interval(time, '0M', 'JST')\nGROUP BY 1" },
    ],
  }
  const master = {
    database: 'ec_dwh', name: 'member_master', logical_name: '会員マスタ', kind: 'master',
    description: 'パーセグのマスターテーブル。1行 = 1統合会員。',
    usage: ['Parent Segment のマスター', '会員属性の分析'], tags: ['会員', 'マスター'], update_frequency: '日次 06:30 JST',
    primary_key: ['member_id'],
    columns: [
      col('member_id', 'varchar', '統合会員ID', { id_system: 'member_id', is_primary_key: true, pii: 'identifier' }),
      col('gender', 'varchar', '性別'),
      col('age_band', 'varchar', '年代', { values: { '10s': '10代', '20s': '20代', '30s': '30代', '40s': '40代', '50s+': '50代以上' } }),
      col('pref', 'varchar', '都道府県'),
      col('first_order_date', 'varchar', '初回購買日'),
      col('ltv', 'double', '累計購買金額（LTV）', { description: '統合購買の累計（税込）。' }),
      timeCol(),
    ],
    sample_queries: [
      { title: '年代別の会員数と平均LTV', engine: 'trino', sql: 'SELECT age_band, COUNT(*) AS members, AVG(ltv) AS avg_ltv\nFROM ec_dwh.member_master\nGROUP BY 1\nORDER BY 1' },
    ],
  }
  const customers = {
    database: 'cdp_audience_1001', name: 'customers', logical_name: 'パーセグ顧客（ミナト会員）', kind: 'segment_output',
    description: 'Parent Segment「ミナト会員」の customers。属性テーブル（会員マスタ）を PIVOT して 1行 = 1顧客（cdp_customer_id）に集約したもの。セグメント・アクティベーションの母集団。',
    usage: ['セグメント作成', 'アクティベーション'], tags: ['CDP', 'パーセグ'], update_frequency: '日次 07:00 JST',
    columns: [
      col('cdp_customer_id', 'varchar', 'CDP顧客ID', { description: 'Audience Studio が採番する ID。' }),
      col('member_id', 'varchar', '統合会員ID', { id_system: 'member_id', pii: 'identifier' }),
      col('gender', 'varchar', '性別'),
      col('age_band', 'varchar', '年代'),
      col('ltv', 'double', '累計購買金額（LTV）'),
    ],
  }
  const summary = {
    database: 'ec_dwh', name: 'daily_sales_summary', logical_name: '日次売上サマリ', kind: 'mart',
    description: 'Saved Query「daily_sales_summary」が毎朝作る日別・チャネル別の売上集計。ダッシュボード用。',
    usage: ['経営ダッシュボード', '日次売上レポート'], tags: ['売上', 'マート'], update_frequency: '日次 07:30 JST',
    primary_key: ['sales_date', 'channel'],
    columns: [
      col('sales_date', 'varchar', '売上日（JST）', { is_primary_key: true }),
      col('channel', 'varchar', '購買チャネル', { is_primary_key: true }),
      col('sales_amount', 'double', '売上金額（税込）'),
      col('order_count', 'bigint', '購買件数'),
      col('buyer_count', 'bigint', '購買者数'),
    ],
    sample_queries: [
      { title: '直近30日の売上推移', engine: 'trino', sql: "SELECT sales_date, SUM(sales_amount) AS sales\nFROM ec_dwh.daily_sales_summary\nWHERE sales_date >= format_datetime(current_date - INTERVAL '30' DAY, 'yyyy-MM-dd')\nGROUP BY 1\nORDER BY 1" },
    ],
  }
  const behaviorOrders = {
    database: 'cdp_audience_1001', name: 'behavior_orders_unified', logical_name: '購買ビヘイビア（ミナト会員）', kind: 'segment_output',
    description: 'ビヘイビア「購買」の出力。ec_dwh.orders_unified に cdp_customer_id を付与したもの。1行 = 1購買。',
    usage: ['購買条件でのセグメント作成', '集計ビヘイビア（直近購入金額など）'], tags: ['CDP', 'パーセグ', '購買'], update_frequency: '日次 07:00 JST',
    columns: [
      col('cdp_customer_id', 'varchar', 'CDP顧客ID', { description: 'Audience Studio が採番する ID。customers と結合する。' }),
      col('order_key', 'varchar', '統合注文キー', { description: '元: ec_dwh.orders_unified.order_key' }),
      col('channel', 'varchar', '購買チャネル', { values: { ec: 'EC', store: '店舗' } }),
      col('order_amount', 'double', '購買金額（税込）', { description: '元: ec_dwh.orders_unified.order_amount' }),
      timeCol(),
    ],
  }
  const behaviorWeb = {
    database: 'cdp_audience_1001', name: 'behavior_web_pageviews', logical_name: 'Web閲覧ビヘイビア（ミナト会員）', kind: 'segment_output',
    description: 'ビヘイビア「Web閲覧」の出力。raw_ec.web_pageviews に cdp_customer_id を付与したもの（会員に紐付いた閲覧のみ）。',
    usage: ['閲覧条件でのセグメント作成'], tags: ['CDP', 'パーセグ', 'Web'], update_frequency: '日次 07:00 JST',
    columns: [
      col('cdp_customer_id', 'varchar', 'CDP顧客ID'),
      col('td_url', 'varchar', 'ページURL', { description: '元: raw_ec.web_pageviews.td_url' }),
      col('td_title', 'varchar', 'ページタイトル'),
      timeCol(),
    ],
  }
  return [shopifyOrders, orderItems, pos, crm, web, unified, master, customers, behaviorOrders, behaviorWeb, ...(revision >= 2 ? [summary] : [])]
}

function lineage(revision) {
  const t = (key, label) => ({ id: `table:${key}`, type: 'table', label, ref: key })
  const nodes = [
    { id: 'source:shopify', type: 'source', label: 'Shopify（日次インポート）', ref: 'shopify' },
    { id: 'source:pos_s3', type: 'source', label: 'POS ファイル（S3）', ref: 'pos_s3' },
    { id: 'source:salesforce', type: 'source', label: 'Salesforce 会員', ref: 'salesforce' },
    { id: 'source:td_js_sdk', type: 'source', label: 'TD JS SDK', ref: 'td_js_sdk' },
    t('raw_ec.shopify_orders', 'EC注文'), t('raw_ec.shopify_order_items', 'EC注文明細'), t('raw_ec.pos_transactions', '店舗POS取引'),
    t('raw_ec.crm_members', 'CRM会員'), t('raw_ec.web_pageviews', 'Web閲覧ログ'), t('ec_dwh.orders_unified', '統合購買'),
    t('ec_dwh.member_master', '会員マスタ'), t('cdp_audience_1001.customers', 'パーセグ顧客'),
    t('cdp_audience_1001.behavior_orders_unified', '購買ビヘイビア'), t('cdp_audience_1001.behavior_web_pageviews', 'Web閲覧ビヘイビア'),
    { id: 'workflow:ec_daily.unify_orders', type: 'workflow', label: 'ec_daily.unify_orders', ref: 'ec_daily.unify_orders' },
    { id: 'workflow:ec_daily.build_member_master', type: 'workflow', label: 'ec_daily.build_member_master', ref: 'ec_daily.build_member_master' },
    { id: 'parent_segment:1001', type: 'parent_segment', label: 'PS: ミナト会員', ref: '1001' },
    { id: 'activation:meta_custom_audience', type: 'activation', label: 'Meta カスタムオーディエンス', ref: 'meta' },
  ]
  const edges = [
    { from: 'source:shopify', to: 'table:raw_ec.shopify_orders', type: 'import', confidence: 'exact' },
    { from: 'source:shopify', to: 'table:raw_ec.shopify_order_items', type: 'import', confidence: 'exact' },
    { from: 'source:pos_s3', to: 'table:raw_ec.pos_transactions', type: 'import', confidence: 'exact' },
    { from: 'source:salesforce', to: 'table:raw_ec.crm_members', type: 'import', confidence: 'exact' },
    { from: 'source:td_js_sdk', to: 'table:raw_ec.web_pageviews', type: 'import', confidence: 'inferred', note: 'テーブル名と td_ 列から推定' },
    { from: 'table:raw_ec.shopify_orders', to: 'workflow:ec_daily.unify_orders', type: 'reads', confidence: 'exact' },
    { from: 'table:raw_ec.pos_transactions', to: 'workflow:ec_daily.unify_orders', type: 'reads', confidence: 'exact' },
    { from: 'table:raw_ec.crm_members', to: 'workflow:ec_daily.unify_orders', type: 'reads', confidence: 'exact' },
    { from: 'workflow:ec_daily.unify_orders', to: 'table:ec_dwh.orders_unified', type: 'writes', confidence: 'exact' },
    { from: 'table:raw_ec.crm_members', to: 'workflow:ec_daily.build_member_master', type: 'reads', confidence: 'exact' },
    { from: 'table:ec_dwh.orders_unified', to: 'workflow:ec_daily.build_member_master', type: 'reads', confidence: 'exact' },
    { from: 'workflow:ec_daily.build_member_master', to: 'table:ec_dwh.member_master', type: 'writes', confidence: 'exact' },
    { from: 'table:ec_dwh.member_master', to: 'table:cdp_audience_1001.customers', type: 'transform', confidence: 'exact', note: 'ps pull の master / attributes' },
    { from: 'table:ec_dwh.orders_unified', to: 'table:cdp_audience_1001.behavior_orders_unified', type: 'transform', confidence: 'exact', note: 'ps pull の behaviors' },
    { from: 'table:raw_ec.web_pageviews', to: 'table:cdp_audience_1001.behavior_web_pageviews', type: 'transform', confidence: 'exact', note: 'ps pull の behaviors' },
    { from: 'table:cdp_audience_1001.customers', to: 'parent_segment:1001', type: 'feeds', confidence: 'exact' },
    { from: 'table:cdp_audience_1001.behavior_orders_unified', to: 'parent_segment:1001', type: 'feeds', confidence: 'exact' },
    { from: 'table:cdp_audience_1001.behavior_web_pageviews', to: 'parent_segment:1001', type: 'feeds', confidence: 'exact' },
    { from: 'parent_segment:1001', to: 'activation:meta_custom_audience', type: 'activates', confidence: 'exact' },
  ]
  if (revision >= 2) {
    nodes.push(
      { id: 'saved_query:daily_sales_summary', type: 'saved_query', label: 'SQ: daily_sales_summary', ref: 'daily_sales_summary' },
      t('ec_dwh.daily_sales_summary', '日次売上サマリ'),
      { id: 'external:bi_dashboard', type: 'external', label: '経営ダッシュボード（BI）', ref: 'bi' },
    )
    edges.push(
      { from: 'table:ec_dwh.orders_unified', to: 'saved_query:daily_sales_summary', type: 'reads', confidence: 'exact' },
      { from: 'saved_query:daily_sales_summary', to: 'table:ec_dwh.daily_sales_summary', type: 'writes', confidence: 'exact' },
      { from: 'table:ec_dwh.daily_sales_summary', to: 'external:bi_dashboard', type: 'feeds', confidence: 'inferred', note: 'BI 接続ユーザーのクエリ履歴から推定' },
    )
  }
  return { nodes, edges }
}

const relationships = () => [
  { from: { table: 'raw_ec.shopify_order_items', columns: ['order_id'] }, to: { table: 'raw_ec.shopify_orders', columns: ['order_id'] }, cardinality: 'many-to-one', confidence: 'confirmed', evidence: '一致率 100%' },
  { from: { table: 'raw_ec.shopify_orders', columns: ['customer_id'] }, to: { table: 'raw_ec.crm_members', columns: ['ec_customer_id'] }, cardinality: 'many-to-one', confidence: 'confirmed', evidence: '非NULLの一致率 97.4%', id_system: 'ec_customer_id' },
  { from: { table: 'raw_ec.pos_transactions', columns: ['member_card_no'] }, to: { table: 'raw_ec.crm_members', columns: ['card_no'] }, cardinality: 'many-to-one', confidence: 'confirmed', evidence: '非NULLの一致率 92.1%', id_system: 'point_card_no' },
  { from: { table: 'raw_ec.web_pageviews', columns: ['member_id'] }, to: { table: 'raw_ec.crm_members', columns: ['member_id'] }, cardinality: 'many-to-one', confidence: 'inferred', evidence: 'ログイン時のみ値あり。一致率 99.0%', id_system: 'member_id' },
  { from: { table: 'ec_dwh.orders_unified', columns: ['member_id'] }, to: { table: 'ec_dwh.member_master', columns: ['member_id'] }, cardinality: 'many-to-one', confidence: 'confirmed', id_system: 'member_id' },
  { from: { table: 'ec_dwh.member_master', columns: ['member_id'] }, to: { table: 'raw_ec.crm_members', columns: ['member_id'] }, cardinality: 'one-to-one', confidence: 'confirmed', id_system: 'member_id' },
  { from: { table: 'cdp_audience_1001.customers', columns: ['member_id'] }, to: { table: 'ec_dwh.member_master', columns: ['member_id'] }, cardinality: 'one-to-one', confidence: 'confirmed', id_system: 'member_id' },
  { from: { table: 'cdp_audience_1001.behavior_orders_unified', columns: ['cdp_customer_id'] }, to: { table: 'cdp_audience_1001.customers', columns: ['cdp_customer_id'] }, cardinality: 'many-to-one', confidence: 'confirmed' },
  { from: { table: 'cdp_audience_1001.behavior_web_pageviews', columns: ['cdp_customer_id'] }, to: { table: 'cdp_audience_1001.customers', columns: ['cdp_customer_id'] }, cardinality: 'many-to-one', confidence: 'confirmed' },
]

function glossary(revision) {
  const recipes = [
    {
      id: 'sales_total', instruction: '売上の合計を出して', aliases: ['売上合計', '売り上げを集計', '売上金額'], term: '売上',
      description: '同じ「売上」でもテーブルごとに計算式が違う。チャネル横断なら統合購買、EC の商品別なら明細を使う。',
      variants: [
        { table: 'ec_dwh.orders_unified', expression: 'SUM(order_amount)', conditions: 'なし（キャンセル除外済み）', notes: 'チャネル横断の標準。迷ったらこれ。', sql: "SELECT SUM(order_amount) AS sales\nFROM ec_dwh.orders_unified\nWHERE td_interval(time, '-1M', 'JST')" },
        { table: 'raw_ec.shopify_orders', expression: 'SUM(order_total)', conditions: "status NOT IN ('cancelled', 'refunded')", notes: '送料込みの税込合計。', sql: "SELECT SUM(order_total) AS sales\nFROM raw_ec.shopify_orders\nWHERE td_interval(time, '-1M', 'JST')\n  AND status NOT IN ('cancelled', 'refunded')" },
        { table: 'raw_ec.shopify_order_items', expression: 'SUM(unit_price * quantity - discount_amount)', conditions: "注文ヘッダと結合し status NOT IN ('cancelled', 'refunded')", notes: '送料を含まない商品売上。order_total の合計とは一致しない。' },
        { table: 'raw_ec.pos_transactions', expression: 'SUM(amount)', conditions: 'なし', notes: '店舗のみ。' },
        ...(revision >= 2 ? [{ table: 'ec_dwh.daily_sales_summary', expression: 'SUM(sales_amount)', conditions: 'sales_date で期間指定（time 列なし）', notes: '集計済みのため最速。日次より細かい粒度は不可。' }] : []),
      ],
    },
    {
      id: 'order_max', instruction: '一番大きい注文はいくら？', aliases: ['最高注文金額', '最大注文額'], term: '注文',
      variants: [
        { table: 'raw_ec.shopify_orders', expression: 'MAX(order_total)', conditions: "status NOT IN ('cancelled', 'refunded')" },
        { table: 'raw_ec.shopify_order_items', expression: '注文ID単位で SUM(unit_price * quantity - discount_amount) してから MAX', conditions: 'GROUP BY order_id', notes: '明細しかない場合の計算方法。' },
      ],
    },
  ]
  if (revision >= 2) {
    recipes.push({
      id: 'buyer_count', instruction: '購入者数を出して', aliases: ['購買者数', '買った人数', 'バイヤー数'], term: '購入者',
      variants: [
        { table: 'ec_dwh.orders_unified', expression: 'COUNT(DISTINCT member_id)', conditions: 'member_id IS NOT NULL', notes: '紐付けできない購買（非会員）は数えない。' },
        { table: 'raw_ec.shopify_orders', expression: 'COUNT(DISTINCT customer_id)', conditions: "status NOT IN ('cancelled', 'refunded')", notes: 'EC会員番号ベース。店舗と合算しない。' },
        { table: 'ec_dwh.daily_sales_summary', expression: '（使用不可）SUM(buyer_count)', notes: '日をまたいだ重複を除けないため、期間の購入者数は orders_unified から出す。' },
      ],
    })
  }
  return {
    terms: [
      { term: '売上', aliases: ['売り上げ', '売上高', 'revenue'], category: 'KPI', definition: '税込・キャンセル/返金除外の購買金額。送料は含む（明細ベースの商品売上は除く）。', related_tables: ['ec_dwh.orders_unified', 'raw_ec.shopify_orders'] },
      { term: '購入者', aliases: ['購買者', 'バイヤー'], category: 'KPI', definition: '期間内に1回以上購買した統合会員。非会員は含めない。' },
      { term: 'アクティブ会員', aliases: ['稼働会員'], category: '会員', definition: '直近365日に1回以上購買した統合会員。', related_tables: ['ec_dwh.member_master'] },
      { term: 'アウトレット店', category: '店舗', definition: '店舗コードが 9 で始まる店舗。通常店舗の売上と分けて報告する。', related_columns: ['raw_ec.pos_transactions.store_code'] },
    ],
    id_systems: [
      { id: 'member_id', name: '統合会員ID', description: 'CRM で採番する全チャネル共通の会員ID。分析の標準キー。', pattern: '^[0-9]{10}$', length: 10, example_masked: '10****0021', status: 'confirmed', columns: ['raw_ec.crm_members.member_id', 'raw_ec.web_pageviews.member_id', 'ec_dwh.orders_unified.member_id', 'ec_dwh.member_master.member_id', 'cdp_audience_1001.customers.member_id'] },
      { id: 'ec_customer_id', name: 'EC会員番号', description: 'Shopify 側の会員番号。統合会員IDとは crm_members で対応付ける。', pattern: '^C[0-9]{7}$', length: 8, example_masked: 'C00****1', status: 'confirmed', columns: ['raw_ec.shopify_orders.customer_id', 'raw_ec.crm_members.ec_customer_id'] },
      { id: 'point_card_no', name: 'ポイントカード番号', description: '店舗のポイントカード番号。', pattern: '^29[0-9]{11}$', length: 13, example_masked: '29**********3', status: 'confirmed', columns: ['raw_ec.pos_transactions.member_card_no', 'raw_ec.crm_members.card_no'] },
      { id: 'td_client_id', name: 'ブラウザID', description: 'TD JS SDK が発行する Cookie ID。', pattern: 'UUID', status: 'confirmed', columns: ['raw_ec.web_pageviews.td_client_id'] },
    ],
    recipes,
    rules: [
      { title: 'キャンセル・返金は売上に含めない', description: "shopify_orders.status が 'cancelled' / 'refunded' の注文は除外する。", applies_to: ['raw_ec.shopify_orders', 'raw_ec.shopify_order_items'] },
      { title: '期間指定は JST', description: "td_interval(time, '-7d', 'JST') のように必ずタイムゾーン JST を指定する。", applies_to: ['raw_ec.shopify_orders', 'raw_ec.pos_transactions', 'ec_dwh.orders_unified'] },
    ],
  }
}

function assets(revision) {
  return {
    sources: [
      { id: 'shopify', name: 'shopify_daily_import', connector_type: 'shopify', schedule: '0 4 * * * (JST)', mode: 'append', target_tables: ['raw_ec.shopify_orders', 'raw_ec.shopify_order_items'], description: 'Shopify 注文の日次増分取込' },
      { id: 'pos_s3', name: 'pos_s3_import', connector_type: 's3_v2', schedule: '0 5 * * * (JST)', mode: 'append', target_tables: ['raw_ec.pos_transactions'] },
      { id: 'salesforce', name: 'sfdc_members', connector_type: 'salesforce', schedule: '0 3 * * * (JST)', mode: 'replace', target_tables: ['raw_ec.crm_members'] },
      { id: 'td_js_sdk', name: 'TD JS SDK（minato-zakka.example）', connector_type: 'td_js_sdk', mode: 'streaming', target_tables: ['raw_ec.web_pageviews'] },
    ],
    workflows: [
      { id: 'ec_daily.unify_orders', project: 'ec_daily', workflow: 'unify_orders', schedule: 'daily>: 06:00:00 (Asia/Tokyo)', description: 'EC と POS を統合会員IDで束ねる', reads: ['raw_ec.shopify_orders', 'raw_ec.pos_transactions', 'raw_ec.crm_members'], writes: ['ec_dwh.orders_unified'] },
      { id: 'ec_daily.build_member_master', project: 'ec_daily', workflow: 'build_member_master', schedule: 'unify_orders の後続', description: '会員マスタを作成', reads: ['raw_ec.crm_members', 'ec_dwh.orders_unified'], writes: ['ec_dwh.member_master'] },
    ],
    saved_queries: revision >= 2 ? [
      { id: 'daily_sales_summary', name: 'daily_sales_summary', schedule: '30 7 * * * (JST)', database: 'ec_dwh', engine: 'trino', description: '日次売上サマリの洗い替え', reads: ['ec_dwh.orders_unified'], writes: ['ec_dwh.daily_sales_summary'], sql: 'SELECT order_date AS sales_date, channel,\n       SUM(order_amount) AS sales_amount,\n       COUNT(*) AS order_count,\n       COUNT(DISTINCT member_id) AS buyer_count\nFROM ec_dwh.orders_unified\nGROUP BY 1, 2' },
    ] : [],
    parent_segments: [
      { id: '1001', name: 'ミナト会員', master_table: 'ec_dwh.member_master', attribute_tables: ['ec_dwh.member_master'], behavior_tables: ['ec_dwh.orders_unified', 'raw_ec.web_pageviews'], output_database: 'cdp_audience_1001', description: '統合会員単位の Parent Segment' },
    ],
  }
}

function writeRevision(revision) {
  for (const table of tables(revision)) write(tablePath(table), table)
  write('lineage.json', lineage(revision))
  write('relationships.json', { relationships: relationships() })
  write('glossary.json', glossary(revision))
  write('assets.json', assets(revision))
}

function updateManifest(patch) {
  const path = join(OUT, 'catalog.json')
  write('catalog.json', { ...JSON.parse(readFileSync(path, 'utf8')), ...patch })
}

main(['init', OUT, '--name', 'minato', '--display-name', 'ミナト雑貨 データカタログ（サンプル）', '--customer', 'ミナト雑貨株式会社（架空）', '--service', 'ミナト雑貨 EC・店舗', '--lang', 'ja', '--site', 'us01'])
const scope = { databases: ['raw_ec', 'ec_dwh', 'cdp_audience_1001'], parent_segments: ['ミナト会員'], workflow_projects: ['ec_daily'], saved_queries: [], sources: ['shopify_daily_import', 'pos_s3_import', 'sfdc_members'], inputs: [] }
updateManifest({
  td: { site: 'us01', console_base_url: CONSOLE, timezone: 'Asia/Tokyo' },
  scope,
  description: '架空の小売企業を想定した合成サンプルです。実在の企業・人物・値は含みません。',
})

writeRevision(1)
main(['release', OUT, '--note', '初版', '--at', '2026-09-01T09:00:00+09:00'])

updateManifest({ scope: { ...scope, saved_queries: ['daily_sales_summary'] } })
writeRevision(2)
main(['release', OUT, '--note', '日次売上サマリ追加・性別コード確定', '--at', '2026-10-01T09:00:00+09:00'])

main(['validate', OUT])
main(['pack', OUT, '--out', join(ROOT, 'public/examples/demo-retail-data-catalog.zip')])
