import { tableKey } from './load.ts'
import type { CatalogBundle, CatalogColumn, CatalogTable } from '../types/catalog.ts'

export type ChangeKind = 'added' | 'removed' | 'changed'

export interface FieldChange {
  field: string
  before?: unknown
  after?: unknown
}

export interface ColumnChange {
  kind: ChangeKind
  name: string
  changes: FieldChange[]
}

export interface TableChange {
  kind: ChangeKind
  key: string
  logicalName?: string
  changes: FieldChange[]
  columns: ColumnChange[]
}

export interface ItemChange {
  kind: ChangeKind
  key: string
  label: string
  changes: FieldChange[]
}

export interface CatalogDiff {
  tables: TableChange[]
  lineage: ItemChange[]
  relationships: ItemChange[]
  terms: ItemChange[]
  recipes: ItemChange[]
  idSystems: ItemChange[]
  assets: ItemChange[]
  summary: Record<string, number>
}

const TABLE_FIELDS = ['logical_name', 'kind', 'description', 'usage', 'tags', 'owner', 'update_frequency', 'primary_key', 'sample_queries'] as const
const COLUMN_FIELDS = ['type', 'logical_name', 'description', 'pii', 'id_system', 'values', 'is_primary_key'] as const

function stable(value: unknown): string {
  if (value === undefined) return ''
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object).sort().map((key) => `${key}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function sameValue(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b)
}

function fieldChanges<T extends object>(before: T, after: T, fields: readonly (keyof T & string)[]): FieldChange[] {
  const changes: FieldChange[] = []
  for (const field of fields) {
    if (!sameValue(before[field], after[field])) changes.push({ field, before: before[field], after: after[field] })
  }
  return changes
}

function diffColumns(before: CatalogColumn[], after: CatalogColumn[]): ColumnChange[] {
  const previous = new Map(before.map((column) => [column.name, column]))
  const next = new Map(after.map((column) => [column.name, column]))
  const result: ColumnChange[] = []
  for (const column of after) {
    const old = previous.get(column.name)
    if (!old) {
      result.push({ kind: 'added', name: column.name, changes: [] })
      continue
    }
    const changes = fieldChanges(old, column, COLUMN_FIELDS)
    if (changes.length) result.push({ kind: 'changed', name: column.name, changes })
  }
  for (const column of before) {
    if (!next.has(column.name)) result.push({ kind: 'removed', name: column.name, changes: [] })
  }
  return result
}

function diffTables(before: CatalogTable[], after: CatalogTable[]): TableChange[] {
  const previous = new Map(before.map((table) => [tableKey(table), table]))
  const next = new Map(after.map((table) => [tableKey(table), table]))
  const result: TableChange[] = []
  for (const [key, table] of next) {
    const old = previous.get(key)
    if (!old) {
      result.push({ kind: 'added', key, logicalName: table.logical_name, changes: [], columns: [] })
      continue
    }
    const changes = fieldChanges(old, table, TABLE_FIELDS)
    const columns = diffColumns(old.columns, table.columns)
    if (changes.length || columns.length) result.push({ kind: 'changed', key, logicalName: table.logical_name, changes, columns })
  }
  for (const [key, table] of previous) {
    if (!next.has(key)) result.push({ kind: 'removed', key, logicalName: table.logical_name, changes: [], columns: [] })
  }
  return result.sort((a, b) => a.key.localeCompare(b.key))
}

/** Diff two keyed lists, comparing every field of the item. */
function diffItems<T>(before: T[], after: T[], keyOf: (item: T) => string, labelOf: (item: T) => string): ItemChange[] {
  const previous = new Map(before.map((item) => [keyOf(item), item]))
  const next = new Map(after.map((item) => [keyOf(item), item]))
  const result: ItemChange[] = []
  for (const [key, item] of next) {
    const old = previous.get(key)
    if (old === undefined) {
      result.push({ kind: 'added', key, label: labelOf(item), changes: [] })
    } else if (!sameValue(old, item)) {
      const fields = new Set([...Object.keys(old as object), ...Object.keys(item as object)])
      const changes = [...fields]
        .filter((field) => !sameValue((old as Record<string, unknown>)[field], (item as Record<string, unknown>)[field]))
        .map((field) => ({ field, before: (old as Record<string, unknown>)[field], after: (item as Record<string, unknown>)[field] }))
      result.push({ kind: 'changed', key, label: labelOf(item), changes })
    }
  }
  for (const [key, item] of previous) {
    if (!next.has(key)) result.push({ kind: 'removed', key, label: labelOf(item), changes: [] })
  }
  return result.sort((a, b) => a.key.localeCompare(b.key))
}

type AssetItem = { key: string; label: string } & Record<string, unknown>

function assetList(bundle: CatalogBundle): AssetItem[] {
  const { sources, workflows, saved_queries: savedQueries, parent_segments: parentSegments } = bundle.assets
  return [
    ...sources.map((item) => ({ key: `source:${item.id}`, label: `Source: ${item.name}`, ...item })),
    ...workflows.map((item) => ({ key: `workflow:${item.id}`, label: `Workflow: ${item.project}.${item.workflow}`, ...item })),
    ...savedQueries.map((item) => ({ key: `saved_query:${item.id}`, label: `Saved Query: ${item.name}`, ...item })),
    ...parentSegments.map((item) => ({ key: `parent_segment:${item.id}`, label: `Parent Segment: ${item.name}`, ...item })),
  ]
}

export function diffCatalogs(before: CatalogBundle, after: CatalogBundle): CatalogDiff {
  const tables = diffTables(before.tables, after.tables)
  const lineage = diffItems(
    before.lineage.edges,
    after.lineage.edges,
    (edge) => `${edge.from} -> ${edge.to}`,
    (edge) => `${edge.from} → ${edge.to}`,
  )
  const relationships = diffItems(
    before.relationships,
    after.relationships,
    (relation) => `${relation.from.table}(${relation.from.columns.join(',')}) -> ${relation.to.table}(${relation.to.columns.join(',')})`,
    (relation) => `${relation.from.table}.${relation.from.columns.join(',')} → ${relation.to.table}.${relation.to.columns.join(',')}`,
  )
  const terms = diffItems(before.glossary.terms, after.glossary.terms, (term) => term.term, (term) => term.term)
  const recipes = diffItems(before.glossary.recipes, after.glossary.recipes, (recipe) => recipe.id, (recipe) => recipe.instruction)
  const idSystems = diffItems(before.glossary.id_systems, after.glossary.id_systems, (system) => system.id, (system) => system.name)
  const assets = diffItems(assetList(before), assetList(after), (item) => item.key, (item) => item.label)

  const count = (kind: ChangeKind) => tables.filter((change) => change.kind === kind).length
  const columnCount = (kind: ChangeKind) =>
    tables.reduce((total, change) => total + change.columns.filter((column) => column.kind === kind).length, 0)
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

export function isEmptyDiff(diff: CatalogDiff): boolean {
  return Object.values(diff.summary).every((value) => value === 0)
}
