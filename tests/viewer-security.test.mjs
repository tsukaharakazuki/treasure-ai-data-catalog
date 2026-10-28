import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { metadataOnly } from '../src/core/privacy.ts'
import { catalogSessionFiles, loadCatalogFromFiles, normalizeBundle } from '../src/core/load.ts'
import { readCatalogZip, ZIP_LIMITS } from '../src/core/zip.ts'
import { unzipFiles, zipFiles } from '../skills/treasure-ai-data-catalog-builder/scripts/catalog-cli.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const DEMO = readFileSync(resolve(ROOT, 'public/examples/demo-retail-data-catalog.zip'))
const filesOf = () => new Map(unzipFiles(DEMO).map((entry) => [entry.path, entry.data.toString('utf8')]))
const entry = (path, text = '{}') => ({ path, data: Buffer.from(text) })
const blobOf = (entries) => new Blob([zipFiles(entries)])
const centralOffset = (zip) => zip.readUInt32LE(zip.length - 6)

function legacyFiles() {
  const files = filesOf()
  for (const [path, text] of files) {
    if (!path.endsWith('.json')) continue
    const data = JSON.parse(text)
    data.samples = { rows: [{ email: 'legacy-only@example.invalid' }] }
    data.example_masked = 'legacy-id-marker'
    files.set(path, JSON.stringify(data))
  }
  files.set('demo-retail-catalog/unrelated.json', '{"samples":{"rows":["unrelated-row-marker"]}}')
  return files
}

test('viewer drops legacy row samples recursively without mutating input metadata', () => {
  const original = { samples: { rows: ['secret-row'] }, nested: [{ example_masked: 'masked-id', privacy: { sample_rows_max: 10 } }], sample_queries: [{ sql: 'SELECT COUNT(*) FROM db.t' }] }
  const clean = metadataOnly(original)
  assert.ok(original.samples)
  assert.deepEqual(clean, { nested: [{ privacy: { sample_rows_max: 0 } }], sample_queries: original.sample_queries })
})

test('viewer loads legacy catalogs but neither current metadata nor snapshots retain sample values', () => {
  const loaded = loadCatalogFromFiles(legacyFiles())
  const serialized = JSON.stringify(loaded)
  for (const forbidden of ['legacy-only', 'legacy-id-marker', '"samples"', '"example_masked"']) assert.ok(!serialized.includes(forbidden), forbidden)
  assert.equal(loaded.tables.length, 11)
  assert.ok(loaded.snapshots.r0001)
  assert.ok(loaded.tables.some((table) => table.sample_queries?.length))
})

test('direct bundle normalization also strips historical row-data fields', () => {
  const loaded = loadCatalogFromFiles(filesOf())
  loaded.tables[0].samples = { rows: ['secret-row-marker'] }
  loaded.glossary.id_systems[0].example_masked = 'legacy-id-marker'
  const clean = normalizeBundle(loaded)
  assert.ok(!JSON.stringify(clean).includes('secret-row-marker'))
  assert.ok(!JSON.stringify(clean).includes('legacy-id-marker'))
})

test('canonical session serialization discards unrelated ZIP files and remains sample-free on reload', () => {
  const loaded = loadCatalogFromFiles(legacyFiles())
  const saved = catalogSessionFiles(loaded)
  const serialized = JSON.stringify([...saved])
  for (const forbidden of ['legacy-only', 'legacy-id-marker', 'unrelated-row-marker', 'unrelated.json']) assert.ok(!serialized.includes(forbidden), forbidden)
  const restored = loadCatalogFromFiles(saved)
  assert.equal(restored.tables.length, loaded.tables.length)
  assert.deepEqual(restored.revisions, loaded.revisions)
  assert.ok(restored.snapshots.r0001)
})

test('JSON parse diagnostics do not echo row values from malformed files', () => {
  const files = filesOf()
  files.set('demo-retail-catalog/tables/raw_ec/crm_members.json', '{"samples":{"email":"do-not-echo@example.invalid"},broken}')
  const loaded = loadCatalogFromFiles(files)
  assert.ok(loaded.diagnostics.some((item) => item.severity === 'error'))
  assert.ok(!JSON.stringify(loaded).includes('do-not-echo'))
})

test('browser ZIP reader loads the metadata-only demo and checks CRC', async () => {
  const files = await readCatalogZip(new Blob([DEMO]))
  assert.equal(loadCatalogFromFiles(files).tables.length, 11)
  const corrupt = zipFiles([entry('catalog.json')])
  corrupt[30 + Buffer.byteLength('catalog.json')] ^= 1
  await assert.rejects(() => readCatalogZip(new Blob([corrupt])), /CRC/)
})

test('browser ZIP reader rejects traversal, path aliases, duplicates and symlinks', async () => {
  for (const path of ['../x.json', '..\\x.json', '/x.json', 'C:/x.json', 'cat/x.json:stream', 'cat//x.json', 'cat/./x.json', 'cat/nul.json', 'cat/x.json.']) {
    await assert.rejects(() => readCatalogZip(blobOf([entry(path)])), /パス/)
  }
  await assert.rejects(() => readCatalogZip(blobOf([entry('x.json'), entry('X.JSON')])), /重複/)
  const link = zipFiles([entry('cat/link')])
  link.writeUInt32LE((0xa1ff << 16) >>> 0, centralOffset(link) + 38)
  await assert.rejects(() => readCatalogZip(new Blob([link])), /リンク/)
})

test('browser ZIP reader bounds input, counts and both declared and actual expansion', async () => {
  await assert.rejects(() => readCatalogZip(new Blob([new Uint8Array(ZIP_LIMITS.maxInputBytes + 1)])), /入力サイズ/)
  await assert.rejects(() => readCatalogZip(blobOf(Array.from({ length: ZIP_LIMITS.maxFiles + 1 }, (_, i) => entry(`x${i}.json`)))), /ファイル数/)
  const declared = zipFiles([entry('x.json')])
  declared.writeUInt32LE(ZIP_LIMITS.maxEntryBytes + 1, centralOffset(declared) + 24)
  await assert.rejects(() => readCatalogZip(new Blob([declared])), /展開サイズ/)
  const actual = zipFiles([{ path: 'x.json', data: Buffer.alloc(2 * 1024 * 1024, 0x61) }])
  actual.writeUInt32LE(1, centralOffset(actual) + 24)
  await assert.rejects(() => readCatalogZip(new Blob([actual])), /実際の展開サイズ/)
})
