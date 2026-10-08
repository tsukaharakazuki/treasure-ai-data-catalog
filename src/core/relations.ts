import { tableKey } from './load.ts'
import type { CatalogBundle, CatalogTable, Relationship } from '../types/catalog.ts'

type Raw = Record<string, unknown>

const isRecord = (value: unknown): value is Raw => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const str = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined)
const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(str).filter((item): item is string => Boolean(item)) : str(value) ? [str(value) as string] : []

/** Relationship lists are written as `{relationships: []}`, `{relations: []}` or a bare array. */
export function relationshipItems(file: unknown): unknown[] {
  if (Array.isArray(file)) return file
  if (isRecord(file)) {
    for (const key of ['relationships', 'relations', 'edges']) if (Array.isArray(file[key])) return file[key] as unknown[]
  }
  return []
}

interface End { table?: string; columns: string[] }

function endFrom(value: unknown, flatTable?: unknown, flatColumns?: unknown): End {
  if (isRecord(value)) {
    const database = str(value.database) ?? str(value.db)
    const name = str(value.table) ?? str(value.name)
    const table = database && name && !name.includes('.') ? `${database}.${name}` : name
    return { table, columns: list(value.columns ?? value.column ?? value.keys ?? value.key) }
  }
  // "db.table.column" or "db.table" strings.
  const text = str(value)
  if (text) {
    const parts = text.split('.')
    if (parts.length >= 3 && !flatColumns) return { table: parts.slice(0, -1).join('.'), columns: [parts.at(-1) as string] }
    return { table: text, columns: list(flatColumns) }
  }
  return { table: str(flatTable), columns: list(flatColumns) }
}

/** Accept the documented shape plus common variants an LLM tends to write. */
export function normalizeRelationship(raw: unknown): Relationship | undefined {
  if (!isRecord(raw)) return undefined
  const from = endFrom(raw.from ?? raw.source ?? raw.child, raw.from_table ?? raw.source_table ?? raw.child_table, raw.from_columns ?? raw.from_column ?? raw.source_column ?? raw.child_column)
  const to = endFrom(raw.to ?? raw.target ?? raw.parent, raw.to_table ?? raw.target_table ?? raw.parent_table, raw.to_columns ?? raw.to_column ?? raw.target_column ?? raw.parent_column)
  if (!from.table || !to.table || !from.columns.length || !to.columns.length) return undefined
  const relationship: Relationship = { from: { table: from.table, columns: from.columns }, to: { table: to.table, columns: to.columns } }
  for (const key of ['id', 'cardinality', 'confidence', 'evidence', 'id_system'] as const) {
    const value = str(raw[key])
    if (value) (relationship as unknown as Raw)[key] = value
  }
  return relationship
}

/** Resolve `table` (no database) to `db.table` when the name is unique in the catalog. */
export function resolveTableKeys(relationships: Relationship[], tables: CatalogTable[]): Relationship[] {
  const keys = new Set(tables.map(tableKey))
  const byName = new Map<string, string[]>()
  for (const table of tables) byName.set(table.name, [...(byName.get(table.name) ?? []), tableKey(table)])
  const resolve = (key: string) => {
    if (keys.has(key)) return key
    const candidates = byName.get(key.split('.').at(-1) ?? key) ?? []
    return candidates.length === 1 ? candidates[0] : key
  }
  return relationships.map((relation) => ({
    ...relation,
    from: { ...relation.from, table: resolve(relation.from.table) },
    to: { ...relation.to, table: resolve(relation.to.table) },
  }))
}

const HUB_NAME = /(master|members?|customers?|users?|accounts?)$/i

/**
 * Candidate relationships from columns sharing an ID system. Each other table
 * points at one hub table per ID system: the table where the column is a key,
 * else a master / customers table. Marked inferred — they are not verified.
 */
export function inferRelationships(bundle: Pick<CatalogBundle, 'tables' | 'relationships' | 'glossary'>): Relationship[] {
  const names = new Map(bundle.glossary.id_systems.map((system) => [system.id, system.name]))
  const groups = new Map<string, { table: CatalogTable; column: string; key: boolean }[]>()
  for (const table of bundle.tables) {
    for (const column of table.columns) {
      if (!column.id_system) continue
      const key = Boolean(column.is_primary_key || table.primary_key?.includes(column.name))
      groups.set(column.id_system, [...(groups.get(column.id_system) ?? []), { table, column: column.name, key }])
    }
  }
  const existing = new Set(bundle.relationships.flatMap((relation) => [
    `${relation.from.table}|${relation.to.table}`, `${relation.to.table}|${relation.from.table}`,
  ]))
  const joined = new Set(bundle.relationships.flatMap((relation) => [relation.from, relation.to].flatMap((end) => end.columns.map((column) => `${end.table}.${column}`))))
  const score = (item: { table: CatalogTable; key: boolean }) =>
    (item.key ? 8 : 0) + (item.table.kind === 'master' ? 4 : 0) + (HUB_NAME.test(item.table.name) ? 2 : 0) + (item.table.kind === 'source' ? 1 : 0)

  const inferred: Relationship[] = []
  for (const [system, members] of groups) {
    const tables = new Set(members.map((member) => tableKey(member.table)))
    if (tables.size < 2) continue
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
