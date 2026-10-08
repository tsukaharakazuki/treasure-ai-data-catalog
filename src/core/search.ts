import { tableKey } from './load.ts'
import type { CatalogBundle, CatalogColumn, CatalogTable } from '../types/catalog.ts'

export interface SearchHit {
  kind: 'table' | 'column' | 'term' | 'recipe'
  /** Table key for table/column hits, term or recipe id otherwise. */
  key: string
  column?: string
  title: string
  subtitle?: string
  score: number
}

export function normalizeText(value: string): string {
  // NFKC folds full-width alphanumerics and half-width kana so 「ＩＤ」 matches "id".
  return value.normalize('NFKC').toLowerCase()
}

function scoreField(query: string, value: string | undefined, weight: number): number {
  if (!value) return 0
  const text = normalizeText(value)
  if (text === query) return weight * 3
  if (text.startsWith(query)) return weight * 2
  return text.includes(query) ? weight : 0
}

/** Whitespace-separated terms; every term must match somewhere (AND). */
export function queryTerms(query: string): string[] {
  return normalizeText(query).split(/\s+/).filter(Boolean)
}

function matchesAll(terms: string[], fields: (string | undefined)[]): boolean {
  const texts = fields.filter((field): field is string => Boolean(field)).map(normalizeText)
  return terms.every((term) => texts.some((text) => text.includes(term)))
}

export function tableMatches(table: CatalogTable, query: string, idSystemNames?: Map<string, string>): boolean {
  const terms = queryTerms(query)
  if (!terms.length) return true
  const fields = [
    tableKey(table),
    table.logical_name,
    table.description,
    ...(table.tags ?? []),
    ...(table.usage ?? []),
    ...table.columns.flatMap((column) => [
      column.name,
      column.logical_name,
      column.description,
      column.id_system,
      column.id_system ? idSystemNames?.get(column.id_system) : undefined,
    ]),
  ]
  return matchesAll(terms, fields)
}

export interface ColumnSearchRow {
  table: CatalogTable
  tableKey: string
  column: CatalogColumn
  /** Which part matched, for display. */
  matchedBy: ('column' | 'logical_name' | 'description' | 'id_system' | 'table')[]
}

export interface ColumnSearchFilters {
  database?: string
  idSystem?: string
  pii?: string
  kind?: string
}

/**
 * Cross-table column search: every column whose own fields (or its table's
 * names) contain all query terms. Used by the テーブル探索 view.
 */
export function searchColumns(bundle: CatalogBundle, query: string, filters: ColumnSearchFilters = {}): ColumnSearchRow[] {
  const terms = queryTerms(query)
  const idNames = new Map(bundle.glossary.id_systems.map((system) => [system.id, system.name]))
  const rows: ColumnSearchRow[] = []
  for (const table of bundle.tables) {
    if (filters.database && table.database !== filters.database) continue
    if (filters.kind && table.kind !== filters.kind) continue
    const key = tableKey(table)
    for (const column of table.columns) {
      if (filters.idSystem && column.id_system !== filters.idSystem) continue
      if (filters.pii && (column.pii ?? 'none') !== filters.pii) continue
      const parts = {
        column: [column.name],
        logical_name: [column.logical_name],
        description: [column.description],
        id_system: [column.id_system, column.id_system ? idNames.get(column.id_system) : undefined],
        table: [key, table.logical_name],
      }
      if (!matchesAll(terms, Object.values(parts).flat())) continue
      const matchedBy = (Object.keys(parts) as (keyof typeof parts)[])
        .filter((part) => terms.some((term) => parts[part].some((field) => field !== undefined && normalizeText(field).includes(term))))
      rows.push({ table, tableKey: key, column, matchedBy })
    }
  }
  return rows
}

export function searchCatalog(bundle: CatalogBundle, rawQuery: string, limit = 30): SearchHit[] {
  const query = normalizeText(rawQuery.trim())
  if (!query) return []
  const hits: SearchHit[] = []
  for (const table of bundle.tables) {
    const key = tableKey(table)
    const score = scoreField(query, key, 5) + scoreField(query, table.name, 5) + scoreField(query, table.logical_name, 5)
      + scoreField(query, table.description, 1) + (table.tags ?? []).reduce((total, tag) => total + scoreField(query, tag, 2), 0)
    if (score) hits.push({ kind: 'table', key, title: table.logical_name ?? key, subtitle: key, score: score + 1 })
    for (const column of table.columns) {
      const columnScore = scoreField(query, column.name, 4) + scoreField(query, column.logical_name, 4) + scoreField(query, column.description, 1)
      if (columnScore) {
        hits.push({
          kind: 'column',
          key,
          column: column.name,
          title: column.logical_name ? `${column.logical_name}（${column.name}）` : column.name,
          subtitle: table.logical_name ? `${table.logical_name} / ${key}` : key,
          score: columnScore,
        })
      }
    }
  }
  for (const term of bundle.glossary.terms) {
    const score = scoreField(query, term.term, 5) + (term.aliases ?? []).reduce((total, alias) => total + scoreField(query, alias, 4), 0)
      + scoreField(query, term.definition, 1)
    if (score) hits.push({ kind: 'term', key: term.term, title: term.term, subtitle: term.definition, score })
  }
  for (const recipe of bundle.glossary.recipes) {
    const score = scoreField(query, recipe.instruction, 5) + (recipe.aliases ?? []).reduce((total, alias) => total + scoreField(query, alias, 4), 0)
      + scoreField(query, recipe.term, 3)
    if (score) hits.push({ kind: 'recipe', key: recipe.id, title: recipe.instruction, subtitle: `${recipe.variants.length} テーブル分の処理`, score })
  }
  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit)
}
