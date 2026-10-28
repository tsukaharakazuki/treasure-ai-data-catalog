#!/usr/bin/env node
// Treasure AI Data Catalog CLI — zero dependencies, patched Node.js 24.22.1+ / 26.12.1+.
//
//   node catalog-cli.mjs init <dir> --name acme [--display-name "..."] [--customer "..."] [--service "..."] [--lang ja] [--site us01] [--by "担当者"] [--no-memory]
//   node catalog-cli.mjs validate <dir>
//   node catalog-cli.mjs release <dir> --note "初版" [--by "Treasure AI Studio"] [--at <ISO8601>] [--allow-empty]
//   node catalog-cli.mjs diff <dir> [--from r0001] [--to r0002|current]
//   node catalog-cli.mjs pack <dir> --out <file.zip>
//   node catalog-cli.mjs unpack <file.zip> <dir> [--by "担当者"]
//   node catalog-cli.mjs relationships <dir> [--write]   # ID体系から ER 候補と一致率検証 SQL を出す
//   node catalog-cli.mjs skill <dir> --out <skills-root-or-skill-dir> [--zip <skill.zip>] [--template <SKILL.md.tmpl>]
//   node catalog-cli.mjs memory <dir> --by "担当者" --stage "収集" --summary "..." [--done "..."] [--decided "..."] [--open "..."] [--next "..."] [--status 進行中|完了|中断]
//
// <dir> はカタログのディレクトリ（例: <共有フォルダ>/data-catalog/catalog）。作業記録は 1 つ上の MEMORY.md に時系列で追記する。
// Treasure AI Studio の「my」フォルダは本人しか見られないため、my の中には何も書き出さない（エラーにする）。
// This tool only touches local files. It never calls Treasure Data or tdx.

import { existsSync, mkdirSync, readdirSync, readFileSync, lstatSync, realpathSync, writeFileSync, copyFileSync } from 'node:fs'
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
    if (lstatSync(dir).isSymbolicLink()) throw new Error('シンボリックリンクはカタログに含められません')
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name)
      const stat = lstatSync(full)
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error('リンク・特殊ファイルはカタログに含められません')
      if (stat.isDirectory()) visit(full)
      else out.push(relative(root, full).split(sep).join('/'))
    }
  }
  visit(root)
  return out
}

// ---------------------------------------------------------------------------
// Relationships (mirrors src/core/relations.ts)

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const str = (value) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)
const strList = (value) => (Array.isArray(value) ? value.map(str).filter(Boolean) : str(value) ? [str(value)] : [])

export function relationshipItems(file) {
  if (Array.isArray(file)) return file
  if (isRecord(file)) for (const key of ['relationships', 'relations', 'edges']) if (Array.isArray(file[key])) return file[key]
  return []
}

function relationEnd(value, flatTable, flatColumns) {
  if (isRecord(value)) {
    const database = str(value.database) ?? str(value.db)
    const name = str(value.table) ?? str(value.name)
    const table = database && name && !name.includes('.') ? `${database}.${name}` : name
    return { table, columns: strList(value.columns ?? value.column ?? value.keys ?? value.key) }
  }
  const text = str(value)
  if (text) {
    const parts = text.split('.')
    if (parts.length >= 3 && !flatColumns) return { table: parts.slice(0, -1).join('.'), columns: [parts.at(-1)] }
    return { table: text, columns: strList(flatColumns) }
  }
  return { table: str(flatTable), columns: strList(flatColumns) }
}

export function normalizeRelationship(raw) {
  if (!isRecord(raw)) return undefined
  const from = relationEnd(raw.from ?? raw.source ?? raw.child, raw.from_table ?? raw.source_table ?? raw.child_table, raw.from_columns ?? raw.from_column ?? raw.source_column ?? raw.child_column)
  const to = relationEnd(raw.to ?? raw.target ?? raw.parent, raw.to_table ?? raw.target_table ?? raw.parent_table, raw.to_columns ?? raw.to_column ?? raw.target_column ?? raw.parent_column)
  if (!from.table || !to.table || !from.columns.length || !to.columns.length) return undefined
  const relation = { from, to }
  for (const key of ['id', 'cardinality', 'confidence', 'evidence', 'id_system']) if (str(raw[key])) relation[key] = str(raw[key])
  return relation
}

const HUB_NAME = /(master|members?|customers?|users?|accounts?)$/i

export function inferRelationships(bundle) {
  const names = new Map(bundle.glossary.id_systems.map((system) => [system.id, system.name]))
  const groups = new Map()
  for (const table of bundle.tables) {
    for (const column of table.columns) {
      if (!column.id_system) continue
      const key = Boolean(column.is_primary_key || table.primary_key?.includes(column.name))
      groups.set(column.id_system, [...(groups.get(column.id_system) ?? []), { table, column: column.name, key }])
    }
  }
  const existing = new Set(bundle.relationships.flatMap((relation) => [`${relation.from.table}|${relation.to.table}`, `${relation.to.table}|${relation.from.table}`]))
  const joined = new Set(bundle.relationships.flatMap((relation) => [relation.from, relation.to].flatMap((end) => end.columns.map((column) => `${end.table}.${column}`))))
  const score = (item) => (item.key ? 8 : 0) + (item.table.kind === 'master' ? 4 : 0) + (HUB_NAME.test(item.table.name) ? 2 : 0) + (item.table.kind === 'source' ? 1 : 0)
  const inferred = []
  for (const [system, members] of groups) {
    if (new Set(members.map((member) => tableKey(member.table))).size < 2) continue
    const hub = [...members].sort((a, b) => score(b) - score(a) || tableKey(a.table).localeCompare(tableKey(b.table)))[0]
    const hubKey = tableKey(hub.table)
    for (const member of members) {
      const key = tableKey(member.table)
      // A column that already takes part in a registered relationship is covered.
      if (key === hubKey || existing.has(`${key}|${hubKey}`) || joined.has(`${key}.${member.column}`)) continue
      existing.add(`${key}|${hubKey}`)
      existing.add(`${hubKey}|${key}`)
      inferred.push({
        from: { table: key, columns: [member.column] },
        to: { table: hubKey, columns: [hub.column] },
        cardinality: member.key && hub.key ? 'one-to-one' : 'many-to-one',
        confidence: 'inferred',
        evidence: `ID体系「${names.get(system) ?? system}」が一致（自動推定・一致率未検証）`,
        id_system: system,
      })
    }
  }
  return inferred
}

export function matchRateSql(relation, bundle) {
  const hasTime = (key) => bundle.tables.find((table) => tableKey(table) === key)?.columns.some((column) => column.name === 'time')
  const a = relation.from
  const b = relation.to
  return `WITH a AS (
  SELECT DISTINCT CAST(${a.columns[0]} AS varchar) AS v
  FROM ${a.table}
  WHERE ${hasTime(a.table) ? "td_interval(time, '-30d') AND " : ''}${a.columns[0]} IS NOT NULL
  LIMIT 100000
),
b AS (
  SELECT DISTINCT CAST(${b.columns[0]} AS varchar) AS v
  FROM ${b.table}
  WHERE ${hasTime(b.table) ? "td_interval(time, '-30d') AND " : ''}${b.columns[0]} IS NOT NULL
)
SELECT COUNT(*) AS sampled, COUNT(b.v) AS matched,
       ROUND(100.0 * COUNT(b.v) / NULLIF(COUNT(*), 0), 1) AS match_pct
FROM a LEFT JOIN b ON a.v = b.v`
}

export function normalizeBundle(value) {
  return {
    catalog: value.catalog,
    tables: arr(value.tables).map((table) => ({ ...table, columns: arr(table.columns) })).sort((a, b) => tableKey(a).localeCompare(tableKey(b))),
    lineage: { nodes: arr(value.lineage?.nodes), edges: arr(value.lineage?.edges) },
    relationships: arr(value.relationships).map(normalizeRelationship).filter(Boolean),
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
  walk(dir) // Reject linked files before reading metadata outside the catalog.
  const tablesDir = join(dir, 'tables')
  const tables = existsSync(tablesDir)
    ? walk(tablesDir).filter((path) => path.endsWith('.json')).map((path) => readJson(join(tablesDir, path)))
    : []
  return normalizeBundle({
    catalog: readJson(join(dir, 'catalog.json')),
    tables,
    lineage: optional('lineage.json'),
    relationships: relationshipItems(optional('relationships.json')),
    glossary: optional('glossary.json'),
    assets: optional('assets.json'),
  })
}

const safeSegment = (value) => String(value).replace(/[\\/:*?"<>|]/g, '_')
export const tablePath = (table) => `tables/${safeSegment(table.database)}/${safeSegment(table.name)}.json`

function readIndex(dir) {
  const path = join(dir, 'revisions/index.json')
  const revisions = existsSync(path) ? arr(readJson(path).revisions) : []
  if (revisions.some((revision) => !/^r\d{4,}$/.test(revision.id) || !Number.isSafeInteger(revision.number) || revision.number < 1)) throw new Error('リビジョンの id / number が不正です')
  return revisions
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
// Sample rows are forbidden, even when masked or stored in old snapshots.
// Inspect the original JSON as well as normalized bundles so unknown fields cannot
// hide rows that would otherwise be copied verbatim into ZIPs or generated skills.
export function sampleDataIssues(value, path = '$') {
  const issues = []
  const pending = [{ value, path }]
  while (pending.length) {
    const item = pending.pop()
    if (!item.value || typeof item.value !== 'object') continue
    for (const [key, child] of Object.entries(item.value)) {
      const location = `${item.path}.${key}`
      if (['samples', 'example_masked'].includes(key) && child !== null) {
        issues.push({ severity: 'error', path: location, message: 'サンプルデータの取得・保存は禁止です。samples / example_masked を削除してください（マスク済み・過去リビジョンも対象）' })
      } else if (key === 'sample_rows_max' && child !== 0) {
        issues.push({ severity: 'error', path: location, message: 'サンプルデータは禁止です。sample_rows_max は 0 にしてください' })
      } else if (child && typeof child === 'object') pending.push({ value: child, path: location })
    }
  }
  return issues
}

export function lintBundle(bundle) {
  const issues = sampleDataIssues(bundle)
  const push = (severity, path, message) => issues.push({ severity, path, message })
  const c = bundle.catalog ?? {}
  if (c.format !== FORMAT) push('error', 'catalog.json', `format は "${FORMAT}" にしてください`)
  if (c.version !== VERSION) push('error', 'catalog.json', `version は数値の ${VERSION} にしてください`)
  if (!c.name || !/^[a-z0-9][a-z0-9-]*$/.test(c.name)) push('error', 'catalog.json', 'name は英小文字・数字・ハイフンのスラッグにしてください（SKILL名 <name>-data-catalog に使います）')
  if (!c.language) push('warning', 'catalog.json', 'language がありません（例: ja）')

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
    if (typeof table.row_count !== 'number') push('warning', key, 'row_count がありません（SELECT COUNT(*) の結果を数値で入れてください）')
    if (table.columns.some((column) => column.name === 'time') && typeof table.last_updated_unixtime !== 'number') {
      push('warning', key, 'last_updated_unixtime がありません（MAX(time) の UNIX 秒を数値で入れてください）')
    }
    for (const column of table.columns) {
      if (!column.name || !column.type) push('error', key, 'カラムには name と type が必要です')
      if (!column.logical_name) push('info', `${key}.${column.name}`, '論理名が未設定です')
      if (column.logical_name_status === 'needs_review') push('info', `${key}.${column.name}`, '論理名が要確認です')
      if (column.id_system && !idSystems.has(column.id_system)) push('warning', `${key}.${column.name}`, `ID体系 "${column.id_system}" が glossary.id_systems にありません`)
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
    if (node.type === 'table' && node.id !== `table:${node.ref ?? node.id.replace(/^table:/, '')}`) {
      push('warning', 'lineage.json', `テーブルノード id "${node.id}" は "table:<db>.<table>"（ref と同じ名前）にしてください`)
    } else if (node.type && node.type !== 'table' && !node.id.startsWith(`${node.type}:`)) {
      push('warning', 'lineage.json', `ノード id "${node.id}" は "${node.type}:<id>" の形にしてください（ビューアーのリンクと差分に使います）`)
    }
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
  if (!bundle.relationships.length) {
    const candidates = inferRelationships(bundle).length
    push(candidates ? 'warning' : 'info', 'relationships.json', candidates
      ? `リレーションが空です。ID体系から ${candidates} 件の候補があります（catalog-cli.mjs relationships で候補と検証 SQL を出力）`
      : 'リレーションが空です。カラムに id_system を付けるか、JOIN 条件からリレーションを作成してください')
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
    if (path.endsWith('.json')) issues.push(...sampleDataIssues(JSON.parse(text), path))
    for (const [pattern, label] of SECRET_PATTERNS) {
      if (pattern.test(text)) issues.push({ severity: 'error', path, message: `${label}が含まれている可能性があります` })
    }
  }
  return issues
}

export function validateDir(dir) {
  const folder = privateFolderOf(dir)
  const location = folder ? [{ severity: 'error', path: '.', message: `カタログが「my」フォルダ（${folder}）の中にあります。my は他のメンバーと共有できないため、my 以外のフォルダへ移してください` }] : []
  return [...location, ...lintBundle(readCatalogDir(dir)), ...scanSecrets(dir)]
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
const TABLE_FIELDS = ['logical_name', 'kind', 'description', 'usage', 'tags', 'update_frequency', 'primary_key', 'sample_queries']
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

export const ZIP_LIMITS = { input: 25 * 1024 * 1024, entry: 10 * 1024 * 1024, total: 100 * 1024 * 1024, entries: 5000 }

function safeZipPath(name) {
  const parts = name.replace(/\/$/, '').split('/')
  if (!name || name.startsWith('/') || /[\\:]/.test(name) || [...name].some((char) => char.charCodeAt(0) < 32) || parts.some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error('ZIP に不正なパスがあります')
  }
  return name
}

export function unzipFiles(buffer) {
  if (buffer.length > ZIP_LIMITS.input) throw new Error('ZIP の入力サイズが上限を超えています')
  const requireBytes = (start, length, end = buffer.length) => {
    if (!Number.isSafeInteger(start) || start < 0 || start + length > end) throw new Error('ZIP のレコード範囲が不正です')
  }
  let eocd = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('ZIP の終端レコードが見つかりません')
  const count = buffer.readUInt16LE(eocd + 10)
  const centralSize = buffer.readUInt32LE(eocd + 12)
  const centralStart = buffer.readUInt32LE(eocd + 16)
  if (buffer.readUInt16LE(eocd + 4) || buffer.readUInt16LE(eocd + 6) || buffer.readUInt16LE(eocd + 8) !== count || count === 0xffff || centralStart === 0xffffffff || centralStart + centralSize !== eocd) throw new Error('分割 ZIP・ZIP64 または不正な ZIP は未対応です')
  if (count > ZIP_LIMITS.entries) throw new Error('ZIP のファイル数が上限を超えています')
  let pointer = centralStart
  let total = 0
  const files = []
  const names = new Set()
  for (let i = 0; i < count; i += 1) {
    requireBytes(pointer, 46, eocd)
    if (buffer.readUInt32LE(pointer) !== 0x02014b50) throw new Error('ZIP のセントラルディレクトリが壊れています')
    const flags = buffer.readUInt16LE(pointer + 8)
    const method = buffer.readUInt16LE(pointer + 10)
    const crc = buffer.readUInt32LE(pointer + 16)
    const compressedSize = buffer.readUInt32LE(pointer + 20)
    const size = buffer.readUInt32LE(pointer + 24)
    const nameLength = buffer.readUInt16LE(pointer + 28)
    const extraLength = buffer.readUInt16LE(pointer + 30)
    const commentLength = buffer.readUInt16LE(pointer + 32)
    const mode = buffer.readUInt32LE(pointer + 38) >>> 16
    const localOffset = buffer.readUInt32LE(pointer + 42)
    requireBytes(pointer, 46 + nameLength + extraLength + commentLength, eocd)
    const name = safeZipPath(buffer.subarray(pointer + 46, pointer + 46 + nameLength).toString('utf8'))
    const canonical = name.replace(/\/$/, '').toLowerCase()
    if (names.has(canonical)) throw new Error('ZIP に重複するパスがあります')
    names.add(canonical)
    if (flags & 1 || ![0, 8].includes(method) || buffer.readUInt16LE(pointer + 34) || (mode & 0xf000) === 0xa000) throw new Error('暗号化・リンク・未対応形式の ZIP エントリです')
    if (size > ZIP_LIMITS.entry || total + size > ZIP_LIMITS.total) throw new Error('ZIP の展開サイズが上限を超えています')
    requireBytes(localOffset, 30, centralStart)
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50 || buffer.readUInt16LE(localOffset + 6) !== flags || buffer.readUInt16LE(localOffset + 8) !== method) throw new Error('ZIP のローカルヘッダーが不正です')
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    requireBytes(localOffset, 30 + localNameLength + localExtraLength + compressedSize, centralStart)
    if (buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString('utf8') !== name) throw new Error('ZIP のファイル名が一致しません')
    const start = localOffset + 30 + localNameLength + localExtraLength
    const raw = buffer.subarray(start, start + compressedSize)
    // maxOutputLength also bounds actual output when the advertised size is false.
    const data = method === 8 ? inflateRawSync(raw, { maxOutputLength: Math.min(ZIP_LIMITS.entry, ZIP_LIMITS.total - total) }) : Buffer.from(raw)
    if (data.length !== size || crc32(data) !== crc) throw new Error('ZIP のサイズまたは CRC が一致しません')
    total += data.length
    if (!name.endsWith('/')) files.push({ path: name, data })
    pointer += 46 + nameLength + extraLength + commentLength
  }
  if (pointer !== eocd) throw new Error('ZIP のディレクトリ長が一致しません')
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
// Shared folders and MEMORY.md
//
// Treasure AI Studio gives every user a private "my" folder that nobody else can open.
// Catalogs, ZIPs, generated skills and the work log are shared deliverables, so they
// must never be written there.

export const PRIVATE_FOLDER = /^my$/i

export function privateFolderOf(path) {
  const parts = resolve(path).split(sep)
  const index = parts.findIndex((part) => PRIVATE_FOLDER.test(part))
  return index < 0 ? undefined : parts.slice(0, index + 1).join(sep) || sep
}

export function assertSharedPath(path, label = '出力先') {
  if (lstatSync(resolve(path), { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('リンクの出力先には書き込めません')
  // Resolve existing ancestors to prevent a symlink from bypassing the private
  // folder rule. Individual output paths are checked separately before writes.
  let ancestor = resolve(path)
  while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) ancestor = dirname(ancestor)
  const folder = privateFolderOf(path) ?? privateFolderOf(realpathSync(ancestor))
  if (folder) {
    throw new Error(`${label}（${resolve(path)}）は「my」フォルダ（${folder}）の中です。my は本人しか開けず他のメンバーと共有できないため、my 以外のフォルダ（例: ${join(dirname(folder), 'data-catalog')}）を作成し、その中で作業してください`)
  }
}

export const MEMORY_FILE = 'MEMORY.md'
export const memoryPath = (dir) => join(dirname(resolve(dir)), MEMORY_FILE)
// Paths in the log are relative to the shared folder so they still make sense for the next person.
const fromWork = (dir, path) => relative(dirname(resolve(dir)), resolve(path)).split(sep).join('/') || '.'

const MEMORY_HEADER = `# MEMORY — データカタログ作業記録

データカタログの作業は段階を分けて、担当者をまたいで進めます。このファイルには **時系列（古い順）** で作業を追記します。
作業を始める人は **最後のエントリ** から「現在の状態」「未解決・要確認」「次にやること」を読んで引き継いでください。

- 追記は \`node catalog-cli.mjs memory <catalog-dir> --by <担当者> --stage <段階> --summary <要約> ...\` で行う（init / release / pack / unpack / skill は自動で 1 行追記する）
- 過去のエントリは書き換えない。訂正は新しいエントリで行う
- API キー・トークン・個人情報の生値は書かない
- このフォルダは「my」以外の共有フォルダに置く（my は本人しか開けない）

`

function stamp(at) {
  if (typeof at === 'string') return at
  const date = new Date()
  const offset = -date.getTimezoneOffset()
  const pad = (value) => String(Math.trunc(Math.abs(value))).padStart(2, '0')
  const local = new Date(date.getTime() + offset * 60000).toISOString()
  return `${local.slice(0, 10)} ${local.slice(11, 16)} (${offset >= 0 ? '+' : '-'}${pad(offset / 60)}:${pad(offset % 60)})`
}

const bullets = (value) => (typeof value === 'string' ? value.split(/\r?\n/).map((line) => line.replace(/^\s*[-*・]\s*/, '').trim()).filter(Boolean) : [])

export function memoryEntry({ at, by, stage, status, summary, done, decided, open, next }) {
  const lines = [`## ${stamp(at)} — ${stage || '作業'} — 担当: ${by || '（未記入）'}`, '']
  if (status) lines.push(`- 状態: ${status}`)
  for (const line of bullets(summary)) lines.push(`- ${line}`)
  for (const [title, value] of [['実施したこと', done], ['決定・確認済み', decided], ['未解決・要確認', open], ['次にやること', next]]) {
    const items = bullets(value)
    if (items.length) lines.push('', `### ${title}`, '', ...items.map((item) => `- ${item}`))
  }
  return `${lines.join('\n')}\n\n`
}

export function appendMemory(dir, entry, { create = false } = {}) {
  const path = memoryPath(dir)
  if (!existsSync(path)) {
    if (!create) return undefined
    assertSharedPath(path, 'MEMORY.md')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, MEMORY_HEADER)
  }
  assertSharedPath(path, 'MEMORY.md')
  if (lstatSync(path).isSymbolicLink()) throw new Error('MEMORY.md のリンクには書き込めません')
  const text = readFileSync(path, 'utf8')
  for (const [pattern, label] of SECRET_PATTERNS) {
    if (pattern.test(JSON.stringify(entry))) throw new Error(`MEMORY.md に書こうとした内容に${label}が含まれている可能性があります。書き込みを中止しました`)
  }
  writeFileSync(path, `${text.replace(/\n*$/, '\n\n')}${memoryEntry(entry)}`.replace(/\n{3,}/g, '\n\n'))
  return path
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
  assertSharedPath(dir, 'カタログの作業ディレクトリ')
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
    privacy: { sample_rows_max: 0, sample_policy: 'サンプルデータの取得・保存は禁止（マスク済みも含む）' },
  })
  writeJson(join(dir, 'lineage.json'), { nodes: [], edges: [] })
  writeJson(join(dir, 'relationships.json'), { relationships: [] })
  writeJson(join(dir, 'glossary.json'), { terms: [], id_systems: [], recipes: [], rules: [] })
  writeJson(join(dir, 'assets.json'), { sources: [], workflows: [], saved_queries: [], parent_segments: [] })
  writeJson(join(dir, 'revisions/index.json'), { revisions: [] })
  mkdirSync(join(dir, 'tables'), { recursive: true })
  console.log(`カタログを初期化しました: ${dir}`)
  if (!flags['no-memory']) {
    const memory = appendMemory(dir, { by: flags.by, stage: '初期化', status: '進行中', summary: `カタログ「${flags.name}」を ${fromWork(dir, dir)}/ に初期化（site: ${site}）` }, { create: true })
    console.log(`作業記録: ${memory}`)
  }
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
  const changed = Object.entries(diff.summary).filter(([, value]) => value).map(([key, value]) => `${key} ${value}`).join(', ')
  appendMemory(dir, { by: flags.by, stage: 'リリース', summary: `${revision.id} をリリース${revision.note ? `（${revision.note}）` : ''}。比較元: ${last?.id ?? '初版'}${changed ? `／変更: ${changed}` : ''}` })
  console.log(diffMarkdown(diff))
}

function loadRevision(dir, id) {
  if (!id || id === 'current') return readCatalogDir(dir)
  if (!/^r\d{4,}$/.test(id)) throw new Error('リビジョン id が不正です')
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
  assertSharedPath(flags.out, 'ZIP の出力先')
  const issues = validateDir(dir)
  if (issues.some((issue) => issue.severity === 'error')) {
    printIssues(issues)
    throw new Error('エラーがあるため ZIP を作成しません（--force でも回避できません）')
  }
  const folder = basename(resolve(dir))
  const files = walk(dir).filter((path) => !PACK_EXCLUDE.some((pattern) => pattern.test(path)))
  const skipped = walk(dir).length - files.length
  appendMemory(dir, { by: flags.by, stage: 'ZIP 作成', summary: `${fromWork(dir, flags.out)} を作成（${readCatalogDir(dir).catalog.revision?.id ?? 'draft'}）` })
  const entries = files.map((path) => ({ path: `${folder}/${path}`, data: readFileSync(join(dir, path)) }))
  // The work log travels with the ZIP so the next person can pick up where the last one stopped.
  const memory = memoryPath(dir)
  if (existsSync(memory) && !files.includes(MEMORY_FILE)) entries.push({ path: `${folder}/${MEMORY_FILE}`, data: readFileSync(memory) })
  const zip = zipFiles(entries)
  mkdirSync(dirname(resolve(flags.out)), { recursive: true })
  writeFileSync(flags.out, zip)
  console.log(`${flags.out} を作成しました（${entries.length} ファイル、${zip.length.toLocaleString()} bytes${skipped ? `、除外 ${skipped} ファイル` : ''}）`)
}

function cmdUnpack(file, dir, flags = {}) {
  if (!file || !dir) throw new Error('unpack <file.zip> <dir>')
  assertSharedPath(dir, '展開先')
  const entries = unzipFiles(readFileSync(file))
  const manifest = entries.map((entry) => entry.path).filter((path) => path === 'catalog.json' || path.endsWith('/catalog.json')).sort((a, b) => a.length - b.length)[0]
  if (!manifest) throw new Error('catalog.json が ZIP にありません')
  const root = manifest.slice(0, -'catalog.json'.length)
  // Existing files or linked ancestors could redirect extraction outside the
  // chosen directory. Refuse all conflicts before writing the first entry.
  const checkTarget = (target) => {
    for (let part = resolve(target); part !== dirname(resolve(dir)) && dirname(part) !== part; part = dirname(part)) {
      if (lstatSync(part, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('リンクを含む展開先には書き込めません')
    }
    if (existsSync(target)) throw new Error('展開先に既存ファイルがあります。新しい空のディレクトリを指定してください')
  }
  for (const entry of entries) {
    if (!entry.path.startsWith(root) || entry.path.slice(root.length) === MEMORY_FILE) continue
    checkTarget(join(dir, entry.path.slice(root.length)))
  }
  const memory = memoryPath(dir)
  if (!existsSync(memory)) checkTarget(memory)
  else if (lstatSync(memory).isSymbolicLink()) throw new Error('MEMORY.md のリンクには書き込めません')
  if (existsSync(join(dirname(memory), 'MEMORY.from-zip.md'))) throw new Error('MEMORY.from-zip.md が既にあります')
  // Check every JSON entry, including snapshots, before writing any file.
  for (const entry of entries) {
    if (!entry.path.startsWith(root) || !entry.path.endsWith('.json')) continue
    if (sampleDataIssues(JSON.parse(entry.data.toString('utf8')), entry.path).length) {
      throw new Error('サンプルデータを含む ZIP は展開できません。samples と旧 privacy 設定を削除したメタデータ専用 ZIP を使用してください')
    }
  }
  let written = 0
  let memoryNote
  for (const entry of entries) {
    if (!entry.path.startsWith(root)) continue
    if (entry.path.slice(root.length) === MEMORY_FILE) {
      const target = memoryPath(dir)
      if (existsSync(target)) {
        if (readFileSync(target, 'utf8') !== entry.data.toString('utf8')) {
          writeFileSync(join(dirname(target), 'MEMORY.from-zip.md'), entry.data)
          memoryNote = `既存の ${target} は残し、ZIP 内の作業記録を MEMORY.from-zip.md に書き出しました。内容を確認して MEMORY.md に統合してください`
        }
      } else {
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, entry.data)
        memoryNote = `ZIP 内の作業記録を ${target} に復元しました。最後のエントリから引き継いでください`
      }
      continue
    }
    const target = join(dir, entry.path.slice(root.length))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, entry.data)
    written += 1
  }
  console.log(`${dir} に ${written} ファイルを展開しました`)
  if (memoryNote) console.log(memoryNote)
  appendMemory(dir, { by: flags.by, stage: '展開', summary: `${basename(file)} を ${fromWork(dir, dir)}/ に展開（${written} ファイル）` }, { create: true })
}

function copyTree(source, target, filter) {
  for (const path of walk(source)) {
    if (!filter(path)) continue
    mkdirSync(dirname(join(target, path)), { recursive: true })
    copyFileSync(join(source, path), join(target, path))
  }
}

function cmdRelationships(dir, flags) {
  const bundle = readCatalogDir(dir)
  const raw = relationshipItems(existsSync(join(dir, 'relationships.json')) ? readJson(join(dir, 'relationships.json')) : [])
  if (raw.length > bundle.relationships.length) console.log(`注意: relationships.json の ${raw.length - bundle.relationships.length} 件は形式を読み取れません（from/to の table と columns が必要）`)
  const candidates = inferRelationships(bundle)
  console.log(`登録済み ${bundle.relationships.length} 件 / ID体系からの候補 ${candidates.length} 件\n`)
  candidates.forEach((relation, index) => {
    console.log(`-- [${index + 1}] ${relation.from.table}.${relation.from.columns[0]} → ${relation.to.table}.${relation.to.columns[0]}（${relation.evidence}）`)
    console.log(`${matchRateSql(relation, bundle)};\n`)
  })
  if (flags.write && candidates.length) {
    assertSharedPath(dir, 'カタログの作業ディレクトリ')
    // Rewrite in the canonical shape, keeping existing entries first.
    writeJson(join(dir, 'relationships.json'), { relationships: [...bundle.relationships, ...candidates] })
    console.log(`relationships.json に ${candidates.length} 件を confidence: inferred で追加しました。一致率を確認したら evidence と confidence を更新してください。`)
  }
}

function cmdSkill(dir, flags) {
  if (!flags.out) throw new Error('--out が必要です（skills ディレクトリ、または生成する skill のディレクトリ）')
  const issues = validateDir(dir)
  if (issues.some((issue) => issue.severity === 'error')) {
    printIssues(issues)
    throw new Error('エラーがあるため SKILL を生成しません')
  }
  const bundle = readCatalogDir(dir)
  const c = bundle.catalog
  const skillName = `${c.name}-data-catalog`
  const out = basename(resolve(flags.out)) === skillName ? resolve(flags.out) : join(resolve(flags.out), skillName)
  assertSharedPath(out, 'SKILL の出力先')
  if (existsSync(out) && readdirSync(out).length) throw new Error('SKILL の出力先が空ではありません。過去のサンプルや不要ファイルの混入を防ぐため、新しい空のディレクトリを指定してください')
  if (typeof flags.zip === 'string') assertSharedPath(flags.zip, '配布用 ZIP の出力先')
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
  appendMemory(dir, { by: flags.by, stage: 'SKILL 生成', summary: `${skillName}（${values.revision}）を ${fromWork(dir, out)}/ に生成${typeof flags.zip === 'string' ? `、配布用 ZIP: ${fromWork(dir, flags.zip)}` : ''}` })
}

function cmdMemory(dir, flags) {
  if (!dir) throw new Error('memory <catalog-dir> --by <担当者> --stage <段階> --summary <要約>')
  if (!flags.by || !flags.stage || !flags.summary) throw new Error('--by（担当者）・--stage（段階）・--summary（要約）が必要です')
  const path = appendMemory(dir, { at: flags.at, by: flags.by, stage: flags.stage, status: flags.status, summary: flags.summary, done: flags.done, decided: flags.decided, open: flags.open, next: flags.next }, { create: true })
  console.log(`${path} に追記しました`)
}

export function assertSupportedNode(version = process.versions.node) {
  const [major, minor, patch] = version.split('.').map(Number)
  if (!((major === 24 && (minor > 22 || (minor === 22 && patch >= 1))) || (major === 26 && (minor > 12 || (minor === 12 && patch >= 1))))) {
    throw new Error('セキュリティ修正済みの Node.js 24.22.1+（24系）または 26.12.1+（26系）を使用してください')
  }
}

export function main(argv) {
  assertSupportedNode()
  const [command, ...rest] = argv
  const { positional, flags } = parseArgs(rest)
  switch (command) {
    case 'init': return cmdInit(positional[0], flags)
    case 'validate': return cmdValidate(positional[0])
    case 'release': return cmdRelease(positional[0], flags)
    case 'diff': return cmdDiff(positional[0], flags)
    case 'pack': return cmdPack(positional[0], flags)
    case 'unpack': return cmdUnpack(positional[0], positional[1], flags)
    case 'relationships': return cmdRelationships(positional[0], flags)
    case 'sample-sql':
    case 'import-samples': throw new Error('サンプルデータの取得・取り込みは禁止されたため、このコマンドは廃止しました')
    case 'skill': return cmdSkill(positional[0], flags)
    case 'memory': return cmdMemory(positional[0], flags)
    default:
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n\n')[0].split('\n').slice(1).map((line) => line.replace(/^\/\/ ?/, '')).join('\n'))
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
