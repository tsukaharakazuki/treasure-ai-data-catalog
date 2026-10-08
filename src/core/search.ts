import { tableKey } from './load.ts'
import type { CatalogBundle, CatalogTable } from '../types/catalog.ts'

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

export function tableMatches(table: CatalogTable, query: string): boolean {
  const normalized = normalizeText(query.trim())
  if (!normalized) return true
  const fields = [
    tableKey(table),
    table.logical_name,
    table.description,
    ...(table.tags ?? []),
    ...(table.usage ?? []),
    ...table.columns.flatMap((column) => [column.name, column.logical_name, column.description]),
  ]
  return fields.some((field) => field !== undefined && normalizeText(field).includes(normalized))
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
