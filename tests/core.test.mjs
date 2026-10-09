import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

import { loadCatalogFromFiles, CatalogLoadError } from '../src/core/load.ts'
import { diffCatalogs } from '../src/core/diff.ts'
import { buildLineageView, neighbours, processesTouching } from '../src/core/lineage.ts'
import { searchCatalog, searchColumns, tableMatches } from '../src/core/search.ts'
import { inferRelationships as inferViewer, normalizeRelationship, relationshipItems } from '../src/core/relations.ts'
import {
  diffBundles,
  inferRelationships as inferCli,
  maskLevel,
  sampleSql,
  normalizeRelationship as normalizeCli,
  lintBundle,
  main,
  normalizeBundle,
  readCatalogDir,
  unzipFiles,
  zipFiles,
} from '../skills/treasure-ai-data-catalog-builder/scripts/catalog-cli.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const SAMPLE_DIR = join(ROOT, 'examples/demo-retail-catalog')
const SAMPLE_ZIP = join(ROOT, 'public/examples/demo-retail-data-catalog.zip')

function sampleFiles() {
  const files = new Map()
  for (const entry of unzipFiles(readFileSync(SAMPLE_ZIP))) files.set(entry.path, entry.data.toString('utf8'))
  return files
}

test('the packed sample loads through the viewer loader with a folder prefix', () => {
  const files = sampleFiles()
  assert.ok([...files.keys()].every((path) => path.startsWith('demo-retail-catalog/')))
  const catalog = loadCatalogFromFiles(files)
  assert.equal(catalog.catalog.name, 'minato')
  assert.equal(catalog.catalog.revision.id, 'r0002')
  assert.equal(catalog.tables.length, 11)
  assert.deepEqual(catalog.revisions.map((revision) => revision.id), ['r0001', 'r0002'])
  assert.ok(catalog.snapshots.r0001)
  assert.equal(catalog.snapshots.r0001.tables.length, 10)
  assert.deepEqual(catalog.diagnostics.filter((item) => item.severity !== 'info'), [])
})

test('loader rejects archives without catalog.json and wrong formats', () => {
  assert.throws(() => loadCatalogFromFiles(new Map([['main.dig', '']])), CatalogLoadError)
  assert.throws(
    () => loadCatalogFromFiles(new Map([['catalog.json', JSON.stringify({ format: 'other', version: 1, name: 'x' })]])),
    CatalogLoadError,
  )
})

test('viewer diff and CLI diff agree on the sample revisions', () => {
  const catalog = loadCatalogFromFiles(sampleFiles())
  const viewer = diffCatalogs(catalog.snapshots.r0001, catalog.snapshots.r0002)
  const cli = diffBundles(normalizeBundle(catalog.snapshots.r0001), normalizeBundle(catalog.snapshots.r0002))
  assert.deepEqual(viewer.summary, cli.summary)
  assert.equal(viewer.summary.tables_added, 1)
  assert.equal(viewer.summary.columns_added, 1)
  const crm = viewer.tables.find((change) => change.key === 'raw_ec.crm_members')
  assert.equal(crm?.columns[0].name, 'gender_code')
  assert.ok(crm?.columns[0].changes.some((change) => change.field === 'logical_name' && change.after === '性別コード'))
})

test('lineage collapses workflows into labelled table edges and focuses', () => {
  const catalog = loadCatalogFromFiles(sampleFiles())
  const collapsed = buildLineageView(catalog.lineage, { collapseProcesses: true })
  assert.ok(!collapsed.nodes.some((node) => node.type === 'workflow' || node.type === 'saved_query'))
  const edge = collapsed.edges.find((item) => item.from === 'table:raw_ec.shopify_orders' && item.to === 'table:ec_dwh.orders_unified')
  assert.deepEqual(edge?.via, ['ec_daily.unify_orders'])

  const focused = buildLineageView(catalog.lineage, { focus: 'table:ec_dwh.member_master', depth: 1 })
  const ids = new Set(focused.nodes.map((node) => node.id))
  assert.ok(ids.has('workflow:ec_daily.build_member_master'))
  // Parent segment sources reach the segment through its output tables, not directly.
  assert.ok(ids.has('table:cdp_audience_1001.customers'))
  assert.ok(!ids.has('parent_segment:1001'))
  assert.ok(!ids.has('source:shopify'))
  const twoHops = buildLineageView(catalog.lineage, { focus: 'table:ec_dwh.member_master', depth: 2 })
  assert.ok(twoHops.nodes.some((node) => node.id === 'parent_segment:1001'))

  const around = neighbours(catalog.lineage, 'table:ec_dwh.orders_unified')
  assert.ok(around.upstream.some((node) => node.id === 'table:raw_ec.pos_transactions'))
  const processes = processesTouching(catalog.lineage, 'table:ec_dwh.orders_unified')
  assert.deepEqual(processes.writers.map((node) => node.id), ['workflow:ec_daily.unify_orders'])
})

test('search matches logical names, full-width input and recipes', () => {
  const catalog = loadCatalogFromFiles(sampleFiles())
  const hits = searchCatalog(catalog, '会員ID')
  assert.ok(hits.some((hit) => hit.kind === 'column' && hit.column === 'member_id'))
  assert.ok(searchCatalog(catalog, 'ＳＨＯＰＩＦＹ').some((hit) => hit.kind === 'table'))
  assert.equal(searchCatalog(catalog, '売り上げを集計')[0].kind, 'recipe')
  assert.ok(tableMatches(catalog.tables.find((table) => table.name === 'crm_members'), 'メール'))
})

test('lint flags unmasked personal samples and too many rows', () => {
  const bundle = readCatalogDir(SAMPLE_DIR)
  const crm = bundle.tables.find((table) => table.name === 'crm_members')
  crm.samples.rows[0].email = 'taro@example.com'
  crm.samples.rows.push(...Array.from({ length: 10 }, () => ({})))
  const errors = lintBundle(bundle).filter((issue) => issue.severity === 'error').map((issue) => issue.message)
  assert.ok(errors.some((message) => message.includes('マスクされていません')))
  assert.ok(errors.some((message) => message.includes('10 行まで')))
})

test('zip round-trips UTF-8 names and content', () => {
  const entries = [
    { path: 'cat/tables/db/売上.json', data: Buffer.from('{"a":"日本語"}') },
    { path: 'cat/empty.txt', data: Buffer.alloc(0) },
  ]
  const back = unzipFiles(zipFiles(entries))
  assert.deepEqual(back.map((entry) => [entry.path, entry.data.toString('utf8')]), entries.map((entry) => [entry.path, entry.data.toString('utf8')]))
})

test('skill command renders the per-customer skill with an index', () => {
  const out = mkdtempSync(join(tmpdir(), 'catalog-skill-'))
  main(['skill', SAMPLE_DIR, '--out', out])
  const skill = join(out, 'minato-data-catalog')
  const text = readFileSync(join(skill, 'SKILL.md'), 'utf8')
  assert.match(text, /^---\nname: minato-data-catalog\n/)
  assert.ok(!text.includes('{{'))
  assert.ok(text.includes('r0002'))
  assert.ok(existsSync(join(skill, 'references/catalog/tables/raw_ec/shopify_orders.json')))
  assert.ok(existsSync(join(skill, 'references/catalog/revisions/index.json')))
  assert.ok(!existsSync(join(skill, 'references/catalog/revisions/r0001.json')))
  const index = readFileSync(join(skill, 'references/INDEX.md'), 'utf8')
  assert.ok(index.includes('売上の合計を出して'))
  assert.ok(index.includes('`raw_ec.shopify_orders`'))
})

test('release refuses to create an empty revision and unpack restores a catalog', () => {
  const work = mkdtempSync(join(tmpdir(), 'catalog-release-'))
  const zip = join(work, 'sample.zip')
  writeFileSync(zip, readFileSync(SAMPLE_ZIP))
  const dir = join(work, 'unpacked')
  main(['unpack', zip, dir])
  main(['release', dir, '--note', 'no-op'])
  const index = JSON.parse(readFileSync(join(dir, 'revisions/index.json'), 'utf8'))
  assert.equal(index.revisions.length, 2)
})

test('column explorer lists matching columns across tables with AND terms and filters', () => {
  const catalog = loadCatalogFromFiles(sampleFiles())
  const rows = searchColumns(catalog, '統合会員ID')
  const keys = new Set(rows.map((row) => row.tableKey))
  assert.ok(keys.size >= 4)
  // Every member_id column, plus columns whose description mentions it.
  assert.equal(rows.filter((row) => row.column.id_system === 'member_id').length, 5)
  assert.ok(rows.find((row) => row.column.name === 'customer_id')?.matchedBy.includes('description'))
  // ID system names match even when the column's own logical name differs.
  assert.ok(searchColumns(catalog, 'ポイントカード').some((row) => row.column.name === 'member_card_no'))
  const both = searchColumns(catalog, '会員 shopify')
  assert.ok(both.length > 0 && both.every((row) => row.tableKey.includes('shopify')))
  assert.ok(searchColumns(catalog, '', { idSystem: 'point_card_no' }).length === 2)
  assert.ok(tableMatches(catalog.tables.find((table) => table.name === 'orders_unified'), '統合 会員'))
})

test('relationship variants an LLM may write are normalized the same in viewer and CLI', () => {
  const variants = [
    { from: { table: 'raw_ec.a', columns: ['x'] }, to: { table: 'raw_ec.b', columns: ['y'] } },
    { from: { database: 'raw_ec', table: 'a', column: 'x' }, to: { database: 'raw_ec', table: 'b', column: 'y' } },
    { from_table: 'raw_ec.a', from_column: 'x', to_table: 'raw_ec.b', to_column: 'y' },
    { from: 'raw_ec.a.x', to: 'raw_ec.b.y' },
    { source: { table: 'raw_ec.a', columns: 'x' }, target: { table: 'raw_ec.b', columns: ['y'] } },
  ]
  for (const variant of variants) {
    const expected = { from: { table: 'raw_ec.a', columns: ['x'] }, to: { table: 'raw_ec.b', columns: ['y'] } }
    assert.deepEqual(normalizeRelationship(variant), expected)
    assert.deepEqual(normalizeCli(variant), expected)
  }
  assert.equal(normalizeRelationship({ from: 'raw_ec.a' }), undefined)
  assert.equal(relationshipItems([1, 2]).length, 2)
  assert.equal(relationshipItems({ relations: [1] }).length, 1)
})

test('relationships are inferred from shared ID systems when none are registered', () => {
  const catalog = loadCatalogFromFiles(sampleFiles())
  const empty = { ...catalog, relationships: [] }
  const viewer = inferViewer(empty)
  assert.deepEqual(viewer, inferCli(normalizeBundle(empty)))
  // member_id hub is the table where it is the primary key.
  const member = viewer.filter((relation) => relation.id_system === 'member_id')
  assert.ok(member.length >= 3)
  assert.ok(member.every((relation) => relation.to.table === member[0].to.table))
  assert.ok(viewer.every((relation) => relation.confidence === 'inferred'))
  // Already registered pairs are not suggested again.
  assert.ok(!inferViewer(catalog).some((relation) => relation.from.table === 'raw_ec.web_pageviews' && relation.to.table === 'raw_ec.crm_members'))

  const files = sampleFiles()
  const root = [...files.keys()][0].split('/')[0]
  files.set(`${root}/relationships.json`, JSON.stringify([{ from_table: 'shopify_order_items', from_column: 'order_id', to_table: 'raw_ec.shopify_orders', to_column: 'order_id' }, { broken: true }]))
  const loaded = loadCatalogFromFiles(files)
  assert.equal(loaded.relationships.length, 1)
  assert.equal(loaded.relationships[0].from.table, 'raw_ec.shopify_order_items')
  assert.ok(loaded.diagnostics.some((item) => item.message.includes('1 件のリレーションを読み取れません')))
})

test('row counts and MAX(time) written under other keys or as strings are normalized', () => {
  const files = sampleFiles()
  const root = [...files.keys()][0].split('/')[0]
  const path = `${root}/tables/raw_ec/shopify_orders.json`
  const table = JSON.parse(files.get(path))
  delete table.row_count
  delete table.last_updated_unixtime
  files.set(path, JSON.stringify({ ...table, rowCount: '1284503', max_time: '1791486600000' }))
  const loaded = loadCatalogFromFiles(files).tables.find((item) => item.name === 'shopify_orders')
  assert.equal(loaded.row_count, 1284503)
  assert.equal(loaded.last_updated_unixtime, 1791486600)
  files.set(path, JSON.stringify({ ...table, last_updated: 1791486600 }))
  assert.equal(loadCatalogFromFiles(files).tables.find((item) => item.name === 'shopify_orders').last_updated_unixtime, 1791486600)
})

test('sample SQL masks every column by pii and name, and import re-masks raw values', () => {
  const table = {
    database: 'db', name: 't',
    columns: [
      { name: 'member_id', type: 'varchar', pii: 'identifier' },
      { name: 'email', type: 'varchar' },
      { name: 'phone_1', type: 'varchar' },
      { name: 'birth_date', type: 'varchar' },
      { name: 'api_key', type: 'varchar' },
      { name: 'tags', type: 'array(varchar)' },
      { name: 'formid', type: 'bigint' },
      { name: 'time', type: 'bigint' },
    ],
  }
  assert.deepEqual(table.columns.map(maskLevel), ['identifier', 'personal', 'personal', 'sensitive', 'exclude', 'complex', 'none', 'none'])
  const sql = sampleSql(table)
  assert.match(sql, /td_interval\(time, '-30d'\)/)
  assert.match(sql, /ORDER BY time DESC\nLIMIT 10/)
  assert.match(sql, /NULL AS "api_key"/)
  assert.match(sql, /\$1\*\*\*@\*\*\*/)
  assert.ok(!/td_interval/.test(sampleSql(table, { range: 'all' })))

  const work = mkdtempSync(join(tmpdir(), 'catalog-samples-'))
  const dir = join(work, 'catalog')
  main(['init', dir, '--name', 'x'])
  mkdirSync(join(dir, 'tables/db'), { recursive: true })
  writeFileSync(join(dir, 'tables/db/t.json'), JSON.stringify({ ...table, row_count: 20 }))
  const result = join(work, 'result.json')
  const raw = Array.from({ length: 12 }, (_, index) => ({ member_id: `1234567890${index}`, email: 'taro@example.com', phone_1: '0312345678', birth_date: '1990-01-01', api_key: 'abc', tags: ['a'], formid: index, time: 1791486600 }))
  writeFileSync(result, JSON.stringify(raw))
  main(['import-samples', dir, '--table', 'db.t', '--file', result])
  const imported = JSON.parse(readFileSync(join(dir, 'tables/db/t.json'), 'utf8')).samples
  assert.equal(imported.rows.length, 10)
  assert.equal(imported.rows[0].member_id, '12****0')
  assert.equal(imported.rows[0].email, 't***@***')
  assert.equal(imported.rows[0].phone_1, '[masked]')
  assert.equal(imported.rows[0].api_key, null)
  assert.equal(imported.rows[3].formid, 3)
  const issues = lintBundle(readCatalogDir(dir)).filter((issue) => issue.path === 'db.t' && issue.severity !== 'info')
  assert.ok(!issues.some((issue) => /サンプル|マスク/.test(issue.message)), JSON.stringify(issues))
})

test('lint flags short or column-poor samples and off-convention lineage ids', () => {
  const bundle = readCatalogDir(SAMPLE_DIR)
  const orders = bundle.tables.find((table) => table.name === 'shopify_orders')
  orders.samples.rows = [{ order_id: '1' }]
  bundle.lineage.nodes.push({ id: 'src_x', type: 'source', label: 'x' }, { id: 'out_customers', type: 'table', label: 'c', ref: 'raw_ec.crm_members' })
  const messages = lintBundle(bundle).map((issue) => issue.message)
  assert.ok(messages.some((message) => message.includes('サンプルが 1 行しかありません')))
  assert.ok(messages.some((message) => message.includes('カラムがありません（全カラムを取得')))
  assert.ok(messages.some((message) => message.includes('"src_x" は "source:<id>"')))
  assert.ok(messages.some((message) => message.includes('"out_customers" は "table:<db>.<table>"')))
})
