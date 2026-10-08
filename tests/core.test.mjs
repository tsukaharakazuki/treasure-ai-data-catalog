import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

import { loadCatalogFromFiles, CatalogLoadError } from '../src/core/load.ts'
import { diffCatalogs } from '../src/core/diff.ts'
import { buildLineageView, neighbours, processesTouching } from '../src/core/lineage.ts'
import { searchCatalog, tableMatches } from '../src/core/search.ts'
import {
  diffBundles,
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
  assert.equal(catalog.tables.length, 9)
  assert.deepEqual(catalog.revisions.map((revision) => revision.id), ['r0001', 'r0002'])
  assert.ok(catalog.snapshots.r0001)
  assert.equal(catalog.snapshots.r0001.tables.length, 8)
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
  assert.ok(ids.has('parent_segment:1001'))
  assert.ok(!ids.has('source:shopify'))

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
  crm.samples.rows.push(...Array.from({ length: 5 }, () => ({})))
  const errors = lintBundle(bundle).filter((issue) => issue.severity === 'error').map((issue) => issue.message)
  assert.ok(errors.some((message) => message.includes('マスクされていません')))
  assert.ok(errors.some((message) => message.includes('5 行まで')))
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
