import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { assertSupportedNode, main, readCatalogDir, unzipFiles, zipFiles, ZIP_LIMITS } from '../skills/treasure-ai-data-catalog-builder/scripts/catalog-cli.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const DEMO = join(ROOT, 'public/examples/demo-retail-data-catalog.zip')
const entry = (path, text = '{}') => ({ path, data: Buffer.from(text) })
const centralOffset = (zip) => zip.readUInt32LE(zip.length - 6)

test('CLI requires a security-patched supported Node.js version', () => {
  for (const version of ['18.20.8', '20.20.0', '22.23.4', '24.22.0', '26.12.0', '25.9.0']) assert.throws(() => assertSupportedNode(version), /Node.js/)
  for (const version of ['24.22.1', '24.23.0', '26.12.1', '26.13.0']) assert.doesNotThrow(() => assertSupportedNode(version))
})

test('ZIP rejects traversal, Windows path aliases and duplicate paths', () => {
  for (const path of ['../outside.json', 'cat/../outside.json', '..\\outside.json', 'C:/outside.json', '/outside.json', 'cat//x.json', 'cat/./x.json', 'cat/x.json:stream', 'cat/nul.json', 'cat/x.json.', 'cat/x\u0000.json']) {
    assert.throws(() => unzipFiles(zipFiles([entry(path)])), /パス/)
  }
  assert.throws(() => unzipFiles(zipFiles([entry('cat/x.json'), entry('cat/x.json')])), /重複/)
  assert.throws(() => unzipFiles(zipFiles([entry('cat/x.json'), entry('CAT/X.JSON')])), /重複/)
})

test('ZIP bounds input, entry counts and advertised expanded sizes', () => {
  assert.throws(() => unzipFiles(Buffer.alloc(ZIP_LIMITS.input + 1)), /入力サイズ/)
  assert.throws(() => unzipFiles(zipFiles(Array.from({ length: ZIP_LIMITS.entries + 1 }, (_, i) => entry(`cat/${i}.json`)))), /ファイル数/)
  const zip = zipFiles([entry('cat/x.json')])
  zip.writeUInt32LE(ZIP_LIMITS.entry + 1, centralOffset(zip) + 24)
  assert.throws(() => unzipFiles(zip), /展開サイズ/)
})

test('ZIP bounds actual inflation even when the expanded size is forged', () => {
  const zip = zipFiles([{ path: 'cat/x.json', data: Buffer.alloc(ZIP_LIMITS.entry + 1, 0x61) }])
  zip.writeUInt32LE(1, centralOffset(zip) + 24)
  assert.throws(() => unzipFiles(zip), (error) => error.code === 'ERR_BUFFER_TOO_LARGE')
})

test('ZIP checks CRC, offsets, local names and encrypted/symlink entries', () => {
  const corrupt = zipFiles([entry('cat/x.json')])
  corrupt[30 + Buffer.byteLength('cat/x.json')] ^= 1
  assert.throws(() => unzipFiles(corrupt), /CRC/)
  const outside = zipFiles([entry('cat/x.json')])
  outside.writeUInt32LE(0xfffffff0, centralOffset(outside) + 42)
  assert.throws(() => unzipFiles(outside), /範囲/)
  const name = zipFiles([entry('cat/x.json')])
  name[30] = 0x62
  assert.throws(() => unzipFiles(name), /ファイル名/)
  const encrypted = zipFiles([entry('cat/x.json')])
  encrypted.writeUInt16LE(0x0801, centralOffset(encrypted) + 8)
  assert.throws(() => unzipFiles(encrypted), /暗号化/)
  const link = zipFiles([entry('cat/link')])
  link.writeUInt32LE((0xa1ff << 16) >>> 0, centralOffset(link) + 38)
  assert.throws(() => unzipFiles(link), /リンク/)
  assert.throws(() => unzipFiles(Buffer.from('not a ZIP')), /終端/)
})

test('unpack preflights existing files and symlinks without writing outside its destination', () => {
  const work = mkdtempSync(join(tmpdir(), 'catalog-zip-safe-'))
  const zip = join(work, 'input.zip')
  writeFileSync(zip, zipFiles([entry('catalog.json', '{}'), entry('tables/db/t.json')]))
  const dir = join(work, 'catalog')
  mkdirSync(join(dir, 'tables'), { recursive: true })
  const external = join(work, 'external')
  mkdirSync(external)
  symlinkSync(external, join(dir, 'tables/db'))
  assert.throws(() => main(['unpack', zip, dir]), /リンク/)
  assert.ok(!existsSync(join(dir, 'catalog.json')))
  assert.ok(!existsSync(join(external, 't.json')))
  const occupied = join(work, 'occupied')
  mkdirSync(occupied)
  writeFileSync(join(occupied, 'catalog.json'), 'unchanged')
  assert.throws(() => main(['unpack', zip, occupied]), /既存ファイル/)
  assert.equal(readFileSync(join(occupied, 'catalog.json'), 'utf8'), 'unchanged')
})

test('catalog reads reject linked files and skill generation rejects malicious catalog names', () => {
  const work = mkdtempSync(join(tmpdir(), 'catalog-links-'))
  const dir = join(work, 'catalog')
  main(['unpack', DEMO, dir])
  symlinkSync(join(dir, 'catalog.json'), join(dir, 'linked.json'))
  assert.throws(() => readCatalogDir(dir), /リンク/)
  const clean = join(work, 'clean')
  main(['unpack', DEMO, clean])
  const manifest = JSON.parse(readFileSync(join(clean, 'catalog.json'), 'utf8'))
  manifest.name = '../../../outside'
  writeFileSync(join(clean, 'catalog.json'), JSON.stringify(manifest))
  assert.throws(() => main(['skill', clean, '--out', join(work, 'skills')]), /SKILL/)
  assert.ok(!existsSync(join(work, 'skills')))
})
