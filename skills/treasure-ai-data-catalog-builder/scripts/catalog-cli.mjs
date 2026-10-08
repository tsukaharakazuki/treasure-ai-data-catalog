#!/usr/bin/env node
// Treasure AI Data Catalog CLI — zero dependencies, Node.js 18+.
//
//   node catalog-cli.mjs init <dir> --name acme [--display-name "..."] [--customer "..."] [--service "..."] [--lang ja] [--site us01]
//   node catalog-cli.mjs validate <dir>
//   node catalog-cli.mjs release <dir> --note "初版" [--by "Treasure AI Studio"] [--at <ISO8601>] [--allow-empty]
//   node catalog-cli.mjs diff <dir> [--from r0001] [--to r0002|current]
//   node catalog-cli.mjs pack <dir> --out <file.zip> [--force]
//   node catalog-cli.mjs unpack <file.zip> <dir>
//   node catalog-cli.mjs skill <dir> --out <skills-root-or-skill-dir> [--zip <skill.zip>] [--template <SKILL.md.tmpl>]
//
// This tool only touches local files. It never calls Treasure Data or tdx.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync, inflateRawSync } from 'node:zlib'

export const FORMAT = 'treasure-ai-data-catalog'
export const VERSION = 1
const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_TEMPLATE = resolve(HERE, '../templates/data-catalog-skill/SKILL.md.tmpl')

// ---------------------------------------------------------------------------
// Reading and writing a catalog directory

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
const arr = (value) => (Array.isArray(value) ? value : [])
export const tableKey = (table) => `${table.database}.${table.name}`

function walk(root) {
  const out = []
  const visit = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) visit(full)
      else out.push(relative(root, full).split(sep).join('/'))
    }
  }
  visit(root)
  return out
}

export function normalizeBundle(value) {
  return {
    catalog: value.catalog,
    tables: arr(value.tables).map((table) => ({ ...table, columns: arr(table.columns) })).sort((a, b) => tableKey(a).localeCompare(tableKey(b))),
    lineage: { nodes: arr(value.lineage?.nodes), edges: arr(value.lineage?.edges) },
    relationships: arr(value.relationships),
    glossary: {
      terms: arr(value.glossary?.terms),
      id_systems: arr(value.glossary?.id_systems),
      recipes: arr(value.glossary?.recipes).map((recipe) => ({ ...recipe, variants: arr(recipe.variants) })),
      rules: arr(value.glossary?.rules),
    },
    assets: {
      sources: arr(value.assets?.sources),
      workflows: arr(value.assets?.workflows),
      saved_queries: arr(value.assets?.saved_queries),
      parent_segments: arr(value.assets?.parent_segments),
    },
  }
}

export function readCatalogDir(dir) {
  const optional = (name) => (existsSync(join(dir, name)) ? readJson(join(dir, name)) : undefined)
  if (!existsSync(join(dir, 'catalog.json'))) throw new Error(`${dir}/catalog.json がありません`)
  const tablesDir = join(dir, 'tables')
  const tables = existsSync(tablesDir)
    ? walk(tablesDir).filter((path) => path.endsWith('.json')).map((path) => readJson(join(tablesDir, path)))
    : []
  return normalizeBundle({
    catalog: readJson(join(dir, 'catalog.json')),
    tables,
    lineage: optional('lineage.json'),
    relationships: optional('relationships.json')?.relationships,
    glossary: optional('glossary.json'),
    assets: optional('assets.json'),
  })
}

const safeSegment = (value) => String(value).replace(/[\\/:*?"<>|]/g, '_')
export const tablePath = (table) => `tables/${safeSegment(table.database)}/${safeSegment(table.name)}.json`

function readIndex(dir) {
  const path = join(dir, 'revisions/index.json')
  return existsSync(path) ? arr(readJson(path).revisions) : []
}

// ---------------------------------------------------------------------------
// Validation

const SECRET_PATTERNS = [
  [/\b\d{3,6}\/[0-9a-f]{40}\b/i, 'TD API キーらしき値'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, '秘密鍵'],
  [/https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/, 'Slack Webhook URL'],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/, 'Slack トークン'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS アクセスキー'],
  [/"(password|passwd|secret|api_?key|access_?token|apikey)"\s*:\s*"[^"]+"/i, '認証情報フィールド'],
]
const MASK_HINT = /[*＊●×]|\[masked\]|\*\*\*/i
const PII_SAMPLE_LEVELS = new Set(['personal', 'sensitive'])

export function lintBundle(bundle) {
  const issues = []
  const push = (severity, path, message) => issues.push({ severity, path, message })
  const c = bundle.catalog ?? {}
  if (c.format !== FORMAT) push('error', 'catalog.json', `format は "${FORMAT}" にしてください`)
  if (c.version !== VERSION) push('error', 'catalog.json', `version は数値の ${VERSION} にしてください`)
  if (!c.name || !/^[a-z0-9][a-z0-9-]*$/.test(c.name)) push('error', 'catalog.json', 'name は英小文字・数字・ハイフンのスラッグにしてください（SKILL名 <name>-data-catalog に使います）')
  if (!c.language) push('warning', 'catalog.json', 'language がありません（例: ja）')

  const maxRows = c.privacy?.sample_rows_max ?? 5
  const keys = new Set()
  const columns = new Map()
  const idSystems = new Set(bundle.glossary.id_systems.map((system) => system.id))
  for (const table of bundle.tables) {
    const key = tableKey(table)
    if (!table.database || !table.name) { push('error', key, 'database と name は必須です'); continue }
    if (keys.has(key)) push('error', key, 'テーブルが重複しています')
    keys.add(key)
    columns.set(key, new Map(table.columns.map((column) => [column.name, column])))
    if (!table.columns.length) push('warning', key, 'カラムがありません')
    if (!table.logical_name) push('info', key, 'テーブル論理名が未設定です')
    if (!table.description) push('info', key, '説明が未設定です')
    for (const column of table.columns) {
      if (!column.name || !column.type) push('error', key, 'カラムには name と type が必要です')
      if (!column.logical_name) push('info', `${key}.${column.name}`, '論理名が未設定です')
      if (column.logical_name_status === 'needs_review') push('info', `${key}.${column.name}`, '論理名が要確認です')
      if (column.id_system && !idSystems.has(column.id_system)) push('warning', `${key}.${column.name}`, `ID体系 "${column.id_system}" が glossary.id_systems にありません`)
    }
    const rows = arr(table.samples?.rows)
    if (rows.length > maxRows) push('error', key, `サンプルは ${maxRows} 行までです（現在 ${rows.length} 行）`)
    for (const column of table.columns) {
      if (!PII_SAMPLE_LEVELS.has(column.pii)) continue
      for (const row of rows) {
        const value = row?.[column.name]
        if (value !== null && value !== undefined && value !== '' && !MASK_HINT.test(String(value))) {
          push('error', `${key}.${column.name}`, `pii=${column.pii} のサンプル値がマスクされていません`)
          break
        }
      }
    }
    for (const query of arr(table.sample_queries)) {
      if (!query.title || !query.sql) push('warning', key, 'sample_queries には title と sql が必要です')
    }
  }

  const nodeIds = new Set()
  for (const node of bundle.lineage.nodes) {
    if (nodeIds.has(node.id)) push('error', 'lineage.json', `ノード id "${node.id}" が重複しています`)
    nodeIds.add(node.id)
    if (node.type === 'table' && node.ref && !keys.has(node.ref)) push('info', 'lineage.json', `テーブルノード "${node.ref}" はカタログ未登録です`)
  }
  for (const edge of bundle.lineage.edges) {
    for (const end of [edge.from, edge.to]) if (!nodeIds.has(end)) push('warning', 'lineage.json', `エッジが未定義ノード "${end}" を参照しています`)
  }
  for (const relation of bundle.relationships) {
    for (const end of [relation.from, relation.to]) {
      if (!columns.has(end?.table)) { push('warning', 'relationships.json', `未登録テーブル "${end?.table}"`); continue }
      for (const column of arr(end.columns)) if (!columns.get(end.table).has(column)) push('warning', 'relationships.json', `"${end.table}" にカラム "${column}" がありません`)
    }
  }
  const recipeIds = new Set()
  for (const recipe of bundle.glossary.recipes) {
    if (!recipe.id) push('error', 'glossary.json', `処理事例 "${recipe.instruction}" に id がありません`)
    if (recipeIds.has(recipe.id)) push('error', 'glossary.json', `処理事例 id "${recipe.id}" が重複しています`)
    recipeIds.add(recipe.id)
    for (const variant of recipe.variants) {
      if (!keys.has(variant.table)) push('warning', 'glossary.json', `処理事例 "${recipe.instruction}" が未登録テーブル "${variant.table}" を参照しています`)
      if (!variant.expression) push('warning', 'glossary.json', `処理事例 "${recipe.instruction}" / ${variant.table} に expression がありません`)
    }
  }
  return issues
}

function scanSecrets(dir) {
  const issues = []
  for (const path of walk(dir)) {
    if (!/\.(json|md|txt|sql|ya?ml)$/i.test(path)) continue
    const text = readFileSync(join(dir, path), 'utf8')
    for (const [pattern, label] of SECRET_PATTERNS) {
      if (pattern.test(text)) issues.push({ severity: 'error', path, message: `${label}が含まれている可能性があります` })
    }
  }
  return issues
}

export function validateDir(dir) {
  return [...lintBundle(readCatalogDir(dir)), ...scanSecrets(dir)]
}

function printIssues(issues) {
  const order = { error: 0, warning: 1, info: 2 }
  const sorted = [...issues].sort((a, b) => order[a.severity] - order[b.severity])
  const counts = { error: 0, warning: 0, info: 0 }
  for (const issue of sorted) counts[issue.severity] += 1
  const infoLimit = 30
  let infos = 0
  for (const issue of sorted) {
    if (issue.severity === 'info' && ++infos > infoLimit) continue
    console.log(`${issue.severity.toUpperCase().padEnd(7)} ${issue.path ?? ''}  ${issue.message}`)
  }
  if (infos > infoLimit) console.log(`INFO    ... ほか ${infos - infoLimit} 件`)
  console.log(`\nerror ${counts.error} / warning ${counts.warning} / info ${counts.info}`)
  return counts
}

// ---------------------------------------------------------------------------
// Diff (mirrors src/core/diff.ts in the viewer — keep the summary keys identical)

const stable = (value) => {
  if (value === undefined) return ''
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${key}:${stable(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
const same = (a, b) => stable(a) === stable(b)
const TABLE_FIELDS = ['logical_name', 'kind', 'description', 'usage', 'tags', 'owner', 'update_frequency', 'primary_key', 'sample_queries']
const COLUMN_FIELDS = ['type', 'logical_name', 'description', 'pii', 'id_system', 'values', 'is_primary_key']

function diffItems(before, after, keyOf, labelOf) {
  const prev = new Map(before.map((item) => [keyOf(item), item]))
  const next = new Map(after.map((item) => [keyOf(item), item]))
  const out = []
  for (const [key, item] of next) {
    const old = prev.get(key)
    if (old === undefined) out.push({ kind: 'added', key, label: labelOf(item), changes: [] })
    else if (!same(old, item)) {
      const fields = [...new Set([...Object.keys(old), ...Object.keys(item)])].filter((field) => !same(old[field], item[field]))
      out.push({ kind: 'changed', key, label: labelOf(item), changes: fields.map((field) => ({ field, before: old[field], after: item[field] })) })
    }
  }
  for (const [key, item] of prev) if (!next.has(key)) out.push({ kind: 'removed', key, label: labelOf(item), changes: [] })
  return out.sort((a, b) => a.key.localeCompare(b.key))
}

export function diffBundles(before, after) {
  const prevTables = new Map(before.tables.map((table) => [tableKey(table), table]))
  const nextTables = new Map(after.tables.map((table) => [tableKey(table), table]))
  const tables = []
  for (const [key, table] of nextTables) {
    const old = prevTables.get(key)
    if (!old) { tables.push({ kind: 'added', key, logicalName: table.logical_name, changes: [], columns: [] }); continue }
    const changes = TABLE_FIELDS.filter((field) => !same(old[field], table[field])).map((field) => ({ field, before: old[field], after: table[field] }))
    const oldColumns = new Map(old.columns.map((column) => [column.name, column]))
    const newColumns = new Map(table.columns.map((column) => [column.name, column]))
    const columns = []
    for (const column of table.columns) {
      const previous = oldColumns.get(column.name)
      if (!previous) { columns.push({ kind: 'added', name: column.name, changes: [] }); continue }
      const fieldChanges = COLUMN_FIELDS.filter((field) => !same(previous[field], column[field])).map((field) => ({ field, before: previous[field], after: column[field] }))
      if (fieldChanges.length) columns.push({ kind: 'changed', name: column.name, changes: fieldChanges })
    }
    for (const column of old.columns) if (!newColumns.has(column.name)) columns.push({ kind: 'removed', name: column.name, changes: [] })
    if (changes.length || columns.length) tables.push({ kind: 'changed', key, logicalName: table.logical_name, changes, columns })
  }
  for (const [key, table] of prevTables) if (!nextTables.has(key)) tables.push({ kind: 'removed', key, logicalName: table.logical_name, changes: [], columns: [] })
  tables.sort((a, b) => a.key.localeCompare(b.key))

  const relKey = (relation) => `${relation.from.table}(${arr(relation.from.columns).join(',')}) -> ${relation.to.table}(${arr(relation.to.columns).join(',')})`
  const assetList = (bundle) => [
    ...bundle.assets.sources.map((item) => ({ key: `source:${item.id}`, label: `Source: ${item.name}`, ...item })),
    ...bundle.assets.workflows.map((item) => ({ key: `workflow:${item.id}`, label: `Workflow: ${item.project}.${item.workflow}`, ...item })),
    ...bundle.assets.saved_queries.map((item) => ({ key: `saved_query:${item.id}`, label: `Saved Query: ${item.name}`, ...item })),
    ...bundle.assets.parent_segments.map((item) => ({ key: `parent_segment:${item.id}`, label: `Parent Segment: ${item.name}`, ...item })),
  ]
  const lineage = diffItems(before.lineage.edges, after.lineage.edges, (edge) => `${edge.from} -> ${edge.to}`, (edge) => `${edge.from} → ${edge.to}`)
  const relationships = diffItems(before.relationships, after.relationships, relKey, relKey)
  const terms = diffItems(before.glossary.terms, after.glossary.terms, (term) => term.term, (term) => term.term)
  const recipes = diffItems(before.glossary.recipes, after.glossary.recipes, (recipe) => recipe.id, (recipe) => recipe.instruction)
  const idSystems = diffItems(before.glossary.id_systems, after.glossary.id_systems, (system) => system.id, (system) => system.name)
  const assets = diffItems(assetList(before), assetList(after), (item) => item.key, (item) => item.label)
  const count = (kind) => tables.filter((change) => change.kind === kind).length
  const columnCount = (kind) => tables.reduce((total, change) => total + change.columns.filter((column) => column.kind === kind).length, 0)
  const summary = {
    tables_added: count('added'),
    tables_removed: count('removed'),
    tables_changed: count('changed'),
    columns_added: columnCount('added'),
    columns_removed: columnCount('removed'),
    columns_changed: columnCount('changed'),
    lineage_changes: lineage.length,
    relationship_changes: relationships.length,
    glossary_changes: terms.length + recipes.length + idSystems.length,
    asset_changes: assets.length,
  }
  return { tables, lineage, relationships, terms, recipes, idSystems, assets, summary }
}

const EMPTY_BUNDLE = normalizeBundle({ catalog: {} })
const KIND_LABEL = { added: '追加', removed: '削除', changed: '変更' }
const show = (value) => (value === undefined ? '（なし）' : typeof value === 'string' ? value : JSON.stringify(value))

export function diffMarkdown(diff) {
  const lines = []
  const s = diff.summary
  lines.push(`- テーブル: 追加 ${s.tables_added} / 削除 ${s.tables_removed} / 変更 ${s.tables_changed}`)
  lines.push(`- カラム: 追加 ${s.columns_added} / 削除 ${s.columns_removed} / 変更 ${s.columns_changed}`)
  lines.push(`- リネージ ${s.lineage_changes} / ER ${s.relationship_changes} / 用語・処理事例・ID体系 ${s.glossary_changes} / アセット ${s.asset_changes}`)
  for (const table of diff.tables) {
    lines.push(`- [${KIND_LABEL[table.kind]}] テーブル \`${table.key}\`${table.logicalName ? `（${table.logicalName}）` : ''}`)
    for (const change of table.changes.filter((item) => item.field !== 'sample_queries')) lines.push(`  - ${change.field}: ${show(change.before)} → ${show(change.after)}`)
    if (table.changes.some((item) => item.field === 'sample_queries')) lines.push('  - sample_queries を更新')
    for (const column of table.columns) {
      const detail = column.changes.map((change) => `${change.field}: ${show(change.before)} → ${show(change.after)}`).join('; ')
      lines.push(`  - [${KIND_LABEL[column.kind]}] カラム \`${column.name}\`${detail ? ` — ${detail}` : ''}`)
    }
  }
  const groups = [['リネージ', diff.lineage], ['ER', diff.relationships], ['用語', diff.terms], ['処理事例', diff.recipes], ['ID体系', diff.idSystems], ['アセット', diff.assets]]
  for (const [label, items] of groups) for (const item of items) lines.push(`- [${KIND_LABEL[item.kind]}] ${label}: ${item.label}`)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// ZIP (deflate via node:zlib, UTF-8 file names)

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()
const crc32 = (buffer) => {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export function zipFiles(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  // Fixed DOS timestamp (2020-01-01) keeps archives reproducible.
  const dosTime = 0
  const dosDate = ((2020 - 1980) << 9) | (1 << 5) | 1
  for (const { path, data } of entries) {
    const name = Buffer.from(path, 'utf8')
    const compressed = deflateRawSync(data, { level: 9 })
    const useDeflate = compressed.length < data.length
    const body = useDeflate ? compressed : data
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(useDeflate ? 8 : 0, 8)
    local.writeUInt16LE(dosTime, 10)
    local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, body)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(useDeflate ? 8 : 0, 10)
    central.writeUInt16LE(dosTime, 12)
    central.writeUInt16LE(dosDate, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + body.length
  }
  const centralSize = centrals.reduce((total, part) => total + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...centrals, end])
}

export function unzipFiles(buffer) {
  let eocd = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('ZIP の終端レコードが見つかりません')
  const count = buffer.readUInt16LE(eocd + 10)
  let pointer = buffer.readUInt32LE(eocd + 16)
  const files = []
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(pointer) !== 0x02014b50) throw new Error('ZIP のセントラルディレクトリが壊れています')
    const method = buffer.readUInt16LE(pointer + 10)
    const compressedSize = buffer.readUInt32LE(pointer + 20)
    const nameLength = buffer.readUInt16LE(pointer + 28)
    const extraLength = buffer.readUInt16LE(pointer + 30)
    const commentLength = buffer.readUInt16LE(pointer + 32)
    const localOffset = buffer.readUInt32LE(pointer + 42)
    const name = buffer.subarray(pointer + 46, pointer + 46 + nameLength).toString('utf8')
    pointer += 46 + nameLength + extraLength + commentLength
    if (name.endsWith('/')) continue
    if (name.startsWith('/') || name.split('/').includes('..')) throw new Error(`不正なパス: ${name}`)
    const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28)
    const raw = buffer.subarray(start, start + compressedSize)
    const data = method === 8 ? inflateRawSync(raw) : method === 0 ? Buffer.from(raw) : null
    if (!data) throw new Error(`未対応の圧縮方式 ${method}: ${name}`)
    files.push({ path: name, data })
  }
  return files
}

const PACK_EXCLUDE = [
  /(^|\/)\.env(\..*)?$/i, /(^|\/)(keys|secrets|logs|node_modules)\//i, /\.(pem|key|p12|pfx|log|csv|tsv|parquet|jsonl|ndjson)$/i,
  /(^|\/)\.DS_Store$/, /(^|\/)\.git\//,
]

// ---------------------------------------------------------------------------
// Skill generation

function render(template, values) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => (values[key] ?? ''))
}

const cell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')

export function indexMarkdown(bundle) {
  const c = bundle.catalog
  const lines = [`# ${c.display_name ?? c.name} — カタログ索引`, '', `リビジョン ${c.revision?.id ?? '-'}（${c.revision?.generated_at ?? '-'}）`, '']
  lines.push('## テーブル一覧', '', '| テーブル | 論理名 | 種別 | 説明 | ファイル |', '| --- | --- | --- | --- | --- |')
  for (const table of bundle.tables) {
    lines.push(`| \`${tableKey(table)}\` | ${cell(table.logical_name)} | ${cell(table.kind)} | ${cell(table.description)} | catalog/${tablePath(table)} |`)
  }
  lines.push('', '## ID体系', '', '| id | 名称 | 形式 | 状態 | 使用カラム |', '| --- | --- | --- | --- | --- |')
  for (const system of bundle.glossary.id_systems) {
    lines.push(`| ${cell(system.id)} | ${cell(system.name)} | ${cell(system.pattern ?? system.length)} | ${cell(system.status)} | ${cell(arr(system.columns).join(', '))} |`)
  }
  lines.push('', '## 社内用語', '', '| 用語 | 別名 | 定義 |', '| --- | --- | --- |')
  for (const term of bundle.glossary.terms) lines.push(`| ${cell(term.term)} | ${cell(arr(term.aliases).join(', '))} | ${cell(term.definition)} |`)
  lines.push('', '## 処理事例（指示 → テーブル別の処理）', '')
  for (const recipe of bundle.glossary.recipes) {
    lines.push(`### ${recipe.instruction}  \`${recipe.id}\``)
    if (arr(recipe.aliases).length) lines.push(`別の言い方: ${recipe.aliases.join(' / ')}`)
    for (const variant of recipe.variants) {
      lines.push(`- \`${variant.table}\`: \`${variant.expression}\`${variant.conditions ? `（条件: ${variant.conditions}）` : ''}${variant.notes ? ` — ${variant.notes}` : ''}`)
    }
    lines.push('')
  }
  if (bundle.glossary.rules.length) {
    lines.push('## 業務ルール', '')
    for (const rule of bundle.glossary.rules) lines.push(`- **${rule.title}**: ${rule.description}${arr(rule.applies_to).length ? `（対象: ${rule.applies_to.join(', ')}）` : ''}`)
    lines.push('')
  }
  lines.push('## アセット', '')
  for (const item of bundle.assets.sources) lines.push(`- Source \`${item.name}\` (${item.connector_type ?? '-'}) → ${arr(item.target_tables).join(', ')}`)
  for (const item of bundle.assets.workflows) lines.push(`- Workflow \`${item.project}.${item.workflow}\` 読: ${arr(item.reads).join(', ') || '-'} / 書: ${arr(item.writes).join(', ') || '-'}`)
  for (const item of bundle.assets.saved_queries) lines.push(`- Saved Query \`${item.name}\` 読: ${arr(item.reads).join(', ') || '-'} / 書: ${arr(item.writes).join(', ') || '-'}`)
  for (const item of bundle.assets.parent_segments) lines.push(`- Parent Segment \`${item.name}\` master: ${item.master_table ?? '-'} / 出力DB: ${item.output_database ?? '-'}`)
  return `${lines.join('\n')}\n`
}

// ---------------------------------------------------------------------------
// Commands

function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) flags[key] = true
      else { flags[key] = next; i += 1 }
    } else positional.push(arg)
  }
  return { positional, flags }
}

const nowIso = () => new Date().toISOString()
const revisionId = (number) => `r${String(number).padStart(4, '0')}`

function cmdInit(dir, flags) {
  if (!flags.name) throw new Error('--name が必要です（例: --name acme）')
  if (existsSync(join(dir, 'catalog.json'))) throw new Error(`${dir} には既にカタログがあります`)
  const site = flags.site ?? 'us01'
  writeJson(join(dir, 'catalog.json'), {
    format: FORMAT,
    version: VERSION,
    name: flags.name,
    display_name: flags['display-name'] ?? `${flags.customer ?? flags.name} データカタログ`,
    customer: flags.customer,
    service: flags.service,
    language: flags.lang ?? 'ja',
    revision: { id: 'draft', number: 0, generated_at: nowIso(), generated_by: 'Treasure AI Studio' },
    td: { site },
    scope: { databases: [], parent_segments: [], workflow_projects: [], saved_queries: [], sources: [], inputs: [] },
    privacy: { sample_rows_max: 5, masking_policy: '氏名・メール・電話・住所・生年月日・端末ID・自由記述はマスクする' },
  })
  writeJson(join(dir, 'lineage.json'), { nodes: [], edges: [] })
  writeJson(join(dir, 'relationships.json'), { relationships: [] })
  writeJson(join(dir, 'glossary.json'), { terms: [], id_systems: [], recipes: [], rules: [] })
  writeJson(join(dir, 'assets.json'), { sources: [], workflows: [], saved_queries: [], parent_segments: [] })
  writeJson(join(dir, 'revisions/index.json'), { revisions: [] })
  mkdirSync(join(dir, 'tables'), { recursive: true })
  console.log(`カタログを初期化しました: ${dir}`)
}

function cmdValidate(dir) {
  const counts = printIssues(validateDir(dir))
  if (counts.error) process.exitCode = 1
}

function cmdRelease(dir, flags) {
  const issues = validateDir(dir)
  if (issues.some((issue) => issue.severity === 'error')) {
    printIssues(issues)
    throw new Error('エラーがあるためリリースできません')
  }
  const index = readIndex(dir)
  const last = index.at(-1)
  const previous = last && existsSync(join(dir, `revisions/${last.id}.json`)) ? normalizeBundle(readJson(join(dir, `revisions/${last.id}.json`))) : EMPTY_BUNDLE
  const current = readCatalogDir(dir)
  const diff = diffBundles(previous, current)
  const empty = Object.values(diff.summary).every((value) => value === 0)
  if (last && empty && !flags['allow-empty']) {
    console.log(`前回 ${last.id} から変更がないため、リビジョンを作成しませんでした（--allow-empty で強制）`)
    return
  }
  const number = (last?.number ?? 0) + 1
  const revision = { id: revisionId(number), number, generated_at: typeof flags.at === 'string' ? flags.at : nowIso(), generated_by: flags.by ?? current.catalog.revision?.generated_by ?? 'Treasure AI Studio', note: typeof flags.note === 'string' ? flags.note : undefined }
  const catalog = { ...current.catalog, revision }
  writeJson(join(dir, 'catalog.json'), catalog)
  writeJson(join(dir, `revisions/${revision.id}.json`), { ...current, catalog })
  writeJson(join(dir, 'revisions/index.json'), { revisions: [...index, { ...revision, previous: last?.id, summary: diff.summary }] })
  const changelogPath = join(dir, 'CHANGELOG.md')
  const existing = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8').replace(/^# 変更履歴\n+/, '') : ''
  const entry = `## ${revision.id} — ${revision.generated_at.slice(0, 10)}${revision.note ? ` ${revision.note}` : ''}\n\n比較元: ${last?.id ?? '（初版）'}\n\n${diffMarkdown(diff)}\n\n`
  writeFileSync(changelogPath, `# 変更履歴\n\n${entry}${existing}`)
  console.log(`${revision.id} をリリースしました`)
  console.log(diffMarkdown(diff))
}

function loadRevision(dir, id) {
  if (!id || id === 'current') return readCatalogDir(dir)
  const path = join(dir, `revisions/${id}.json`)
  if (!existsSync(path)) throw new Error(`リビジョン ${id} がありません`)
  return normalizeBundle(readJson(path))
}

function cmdDiff(dir, flags) {
  const index = readIndex(dir)
  const from = flags.from ?? index.at(-1)?.id
  const before = from ? loadRevision(dir, from) : EMPTY_BUNDLE
  const after = loadRevision(dir, flags.to ?? 'current')
  console.log(`# ${from ?? '（空）'} → ${flags.to ?? 'current'}\n`)
  console.log(diffMarkdown(diffBundles(before, after)))
}

function cmdPack(dir, flags) {
  if (!flags.out) throw new Error('--out が必要です')
  const issues = validateDir(dir)
  if (issues.some((issue) => issue.severity === 'error') && !flags.force) {
    printIssues(issues)
    throw new Error('エラーがあるため ZIP を作成しません（--force で強制）')
  }
  const folder = basename(resolve(dir))
  const files = walk(dir).filter((path) => !PACK_EXCLUDE.some((pattern) => pattern.test(path)))
  const skipped = walk(dir).length - files.length
  const zip = zipFiles(files.map((path) => ({ path: `${folder}/${path}`, data: readFileSync(join(dir, path)) })))
  mkdirSync(dirname(resolve(flags.out)), { recursive: true })
  writeFileSync(flags.out, zip)
  console.log(`${flags.out} を作成しました（${files.length} ファイル、${zip.length.toLocaleString()} bytes${skipped ? `、除外 ${skipped} ファイル` : ''}）`)
}

function cmdUnpack(file, dir) {
  if (!file || !dir) throw new Error('unpack <file.zip> <dir>')
  const entries = unzipFiles(readFileSync(file))
  const manifest = entries.map((entry) => entry.path).filter((path) => path === 'catalog.json' || path.endsWith('/catalog.json')).sort((a, b) => a.length - b.length)[0]
  if (!manifest) throw new Error('catalog.json が ZIP にありません')
  const root = manifest.slice(0, -'catalog.json'.length)
  let written = 0
  for (const entry of entries) {
    if (!entry.path.startsWith(root)) continue
    const target = join(dir, entry.path.slice(root.length))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, entry.data)
    written += 1
  }
  console.log(`${dir} に ${written} ファイルを展開しました`)
}

function copyTree(source, target, filter) {
  for (const path of walk(source)) {
    if (!filter(path)) continue
    mkdirSync(dirname(join(target, path)), { recursive: true })
    copyFileSync(join(source, path), join(target, path))
  }
}

function cmdSkill(dir, flags) {
  if (!flags.out) throw new Error('--out が必要です（skills ディレクトリ、または生成する skill のディレクトリ）')
  const bundle = readCatalogDir(dir)
  const c = bundle.catalog
  const skillName = `${c.name}-data-catalog`
  const out = basename(resolve(flags.out)) === skillName ? resolve(flags.out) : join(resolve(flags.out), skillName)
  const template = readFileSync(typeof flags.template === 'string' ? flags.template : DEFAULT_TEMPLATE, 'utf8')
  const databases = [...new Set(bundle.tables.map((table) => table.database))]
  const values = {
    skill_name: skillName,
    name: c.name,
    display_name: c.display_name ?? c.name,
    customer: c.customer ?? c.name,
    service: c.service ?? '',
    language: c.language ?? 'ja',
    site: c.td?.site ?? 'us01',
    revision: c.revision?.id ?? 'draft',
    generated_at: c.revision?.generated_at ?? '',
    table_count: String(bundle.tables.length),
    databases: databases.join(', '),
    term_examples: bundle.glossary.terms.slice(0, 6).map((term) => `「${term.term}」`).join(''),
    recipe_examples: bundle.glossary.recipes.slice(0, 4).map((recipe) => `「${recipe.instruction}」`).join(''),
  }
  mkdirSync(join(out, 'references'), { recursive: true })
  writeFileSync(join(out, 'SKILL.md'), render(template, values))
  // Snapshots of older revisions are not needed to answer questions; keep the index and changelog.
  copyTree(dir, join(out, 'references/catalog'), (path) => !PACK_EXCLUDE.some((pattern) => pattern.test(path)) && !/^revisions\/(?!index\.json$)/.test(path))
  writeFileSync(join(out, 'references/INDEX.md'), indexMarkdown(bundle))
  console.log(`SKILL を生成しました: ${out}`)
  if (typeof flags.zip === 'string') {
    const zip = zipFiles(walk(out).map((path) => ({ path: `${skillName}/${path}`, data: readFileSync(join(out, path)) })))
    mkdirSync(dirname(resolve(flags.zip)), { recursive: true })
    writeFileSync(flags.zip, zip)
    console.log(`配布用 ZIP を作成しました: ${flags.zip}`)
  }
}

export function main(argv) {
  const [command, ...rest] = argv
  const { positional, flags } = parseArgs(rest)
  switch (command) {
    case 'init': return cmdInit(positional[0], flags)
    case 'validate': return cmdValidate(positional[0])
    case 'release': return cmdRelease(positional[0], flags)
    case 'diff': return cmdDiff(positional[0], flags)
    case 'pack': return cmdPack(positional[0], flags)
    case 'unpack': return cmdUnpack(positional[0], positional[1])
    case 'skill': return cmdSkill(positional[0], flags)
    default:
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 12).map((line) => line.replace(/^\/\/ ?/, '')).join('\n'))
      if (command && command !== 'help') process.exitCode = 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(`エラー: ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  }
}
