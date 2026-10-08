import { CATALOG_FORMAT, CATALOG_VERSION } from '../types/catalog.ts'
import { inferRelationships, normalizeRelationship, relationshipItems, resolveTableKeys } from './relations.ts'
import type {
  Assets,
  CatalogBundle,
  CatalogDiagnostic,
  CatalogManifest,
  CatalogTable,
  Glossary,
  Lineage,
  LoadedCatalog,
  Relationship,
  RevisionIndexEntry,
} from '../types/catalog.ts'

export const EMPTY_GLOSSARY: Glossary = { terms: [], id_systems: [], recipes: [], rules: [] }
export const EMPTY_ASSETS: Assets = { sources: [], workflows: [], saved_queries: [], parent_segments: [] }
export const EMPTY_LINEAGE: Lineage = { nodes: [], edges: [] }

export class CatalogLoadError extends Error {}

export function tableKey(table: Pick<CatalogTable, 'database' | 'name'>): string {
  return `${table.database}.${table.name}`
}

/**
 * Catalogs are often zipped together with their folder, so every path may share
 * one leading directory. Find the directory that holds catalog.json and strip it.
 */
export function stripCatalogRoot(files: Map<string, string>): Map<string, string> {
  const manifests = [...files.keys()].filter((path) => path === 'catalog.json' || path.endsWith('/catalog.json'))
  if (manifests.length === 0) {
    throw new CatalogLoadError('catalog.json が見つかりません。Treasure AI Data Catalog の ZIP を選択してください。')
  }
  const root = manifests.sort((a, b) => a.length - b.length)[0].slice(0, -'catalog.json'.length)
  if (!root) return files
  const stripped = new Map<string, string>()
  for (const [path, text] of files) {
    if (path.startsWith(root)) stripped.set(path.slice(root.length), text)
  }
  return stripped
}

function parseJson<T>(text: string, path: string, diagnostics: CatalogDiagnostic[]): T | undefined {
  try {
    return JSON.parse(text) as T
  } catch (error) {
    diagnostics.push({
      severity: 'error',
      path,
      message: `JSON を解析できません: ${error instanceof Error ? error.message : String(error)}`,
    })
    return undefined
  }
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

export function normalizeGlossary(value: Partial<Glossary> | undefined): Glossary {
  return {
    terms: asArray(value?.terms),
    id_systems: asArray(value?.id_systems),
    recipes: asArray(value?.recipes).map((recipe) => ({ ...(recipe as object), variants: asArray((recipe as { variants?: unknown }).variants) })) as Glossary['recipes'],
    rules: asArray(value?.rules),
  }
}

export function normalizeAssets(value: Partial<Assets> | undefined): Assets {
  return {
    sources: asArray(value?.sources),
    workflows: asArray(value?.workflows),
    saved_queries: asArray(value?.saved_queries),
    parent_segments: asArray(value?.parent_segments),
  }
}

export function normalizeLineage(value: Partial<Lineage> | undefined): Lineage {
  return { nodes: asArray(value?.nodes), edges: asArray(value?.edges) }
}

export function normalizeTable(value: CatalogTable): CatalogTable {
  return { ...value, columns: asArray(value.columns) }
}

export function normalizeBundle(value: Partial<CatalogBundle>): CatalogBundle {
  return {
    catalog: value.catalog as CatalogManifest,
    tables: asArray<CatalogTable>(value.tables).map(normalizeTable).sort(compareTables),
    lineage: normalizeLineage(value.lineage),
    relationships: asArray(value.relationships).map(normalizeRelationship).filter((item): item is Relationship => Boolean(item)),
    glossary: normalizeGlossary(value.glossary),
    assets: normalizeAssets(value.assets),
  }
}

export function compareTables(a: CatalogTable, b: CatalogTable): number {
  return tableKey(a).localeCompare(tableKey(b))
}

export function validateManifest(manifest: CatalogManifest | undefined, diagnostics: CatalogDiagnostic[]): void {
  if (!manifest || typeof manifest !== 'object') {
    diagnostics.push({ severity: 'error', path: 'catalog.json', message: 'catalog.json が空です。' })
    return
  }
  if (manifest.format !== CATALOG_FORMAT) {
    diagnostics.push({ severity: 'error', path: 'catalog.json', message: `format は "${CATALOG_FORMAT}" である必要があります。` })
  }
  if (manifest.version !== CATALOG_VERSION) {
    diagnostics.push({ severity: 'error', path: 'catalog.json', message: `version は数値の ${CATALOG_VERSION} である必要があります。` })
  }
  if (!manifest.name) diagnostics.push({ severity: 'error', path: 'catalog.json', message: 'name がありません。' })
  if (!manifest.revision?.id) diagnostics.push({ severity: 'warning', path: 'catalog.json', message: 'revision.id がありません。' })
}

/** Cross-reference checks shared by the browser viewer and the CLI. */
export function lintBundle(bundle: CatalogBundle): CatalogDiagnostic[] {
  const diagnostics: CatalogDiagnostic[] = []
  const tables = new Set(bundle.tables.map(tableKey))
  const columns = new Map(bundle.tables.map((table) => [tableKey(table), new Set(table.columns.map((column) => column.name))]))
  const idSystems = new Set(bundle.glossary.id_systems.map((system) => system.id))
  const nodeIds = new Set(bundle.lineage.nodes.map((node) => node.id))

  for (const table of bundle.tables) {
    const key = tableKey(table)
    if (table.columns.length === 0) diagnostics.push({ severity: 'warning', path: key, message: 'カラム定義がありません。' })
    for (const column of table.columns) {
      if (!column.logical_name) diagnostics.push({ severity: 'info', path: `${key}.${column.name}`, message: '論理名が未設定です。' })
      if (column.logical_name_status === 'needs_review') {
        diagnostics.push({ severity: 'info', path: `${key}.${column.name}`, message: '論理名が要確認です。' })
      }
      if (column.id_system && !idSystems.has(column.id_system)) {
        diagnostics.push({ severity: 'warning', path: `${key}.${column.name}`, message: `ID体系 "${column.id_system}" が glossary.id_systems にありません。` })
      }
    }
  }
  for (const edge of bundle.lineage.edges) {
    for (const end of [edge.from, edge.to]) {
      if (!nodeIds.has(end)) diagnostics.push({ severity: 'warning', path: 'lineage.json', message: `エッジが未定義のノード "${end}" を参照しています。` })
    }
  }
  for (const relation of bundle.relationships) {
    for (const end of [relation.from, relation.to]) {
      if (!tables.has(end.table)) {
        diagnostics.push({ severity: 'warning', path: 'relationships.json', message: `リレーションが未登録のテーブル "${end.table}" を参照しています。` })
        continue
      }
      for (const column of end.columns) {
        if (!columns.get(end.table)?.has(column)) {
          diagnostics.push({ severity: 'warning', path: 'relationships.json', message: `"${end.table}" にカラム "${column}" がありません。` })
        }
      }
    }
  }
  if (bundle.relationships.length === 0) {
    const candidates = inferRelationships(bundle).length
    if (candidates) {
      diagnostics.push({ severity: 'warning', path: 'relationships.json', message: `リレーションが登録されていません。ID体系から ${candidates} 件の候補を推定できます（ER図で「ID体系から推定」を表示）。` })
    }
  }
  for (const recipe of bundle.glossary.recipes) {
    for (const variant of recipe.variants) {
      if (!tables.has(variant.table)) {
        diagnostics.push({ severity: 'warning', path: 'glossary.json', message: `処理事例 "${recipe.instruction}" が未登録のテーブル "${variant.table}" を参照しています。` })
      }
    }
  }
  return diagnostics
}

/** Build a catalog from the text members of an unpacked ZIP. */
export function loadCatalogFromFiles(input: Map<string, string>): LoadedCatalog {
  const files = stripCatalogRoot(input)
  const diagnostics: CatalogDiagnostic[] = []

  const manifest = parseJson<CatalogManifest>(files.get('catalog.json') ?? '', 'catalog.json', diagnostics)
  validateManifest(manifest, diagnostics)
  if (!manifest || diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    throw new CatalogLoadError(diagnostics.map((diagnostic) => diagnostic.message).join('\n') || 'catalog.json を読み込めません。')
  }

  const tables: CatalogTable[] = []
  for (const [path, text] of files) {
    if (!path.startsWith('tables/') || !path.endsWith('.json')) continue
    const table = parseJson<CatalogTable>(text, path, diagnostics)
    if (!table) continue
    if (!table.database || !table.name) {
      diagnostics.push({ severity: 'error', path, message: 'database と name は必須です。' })
      continue
    }
    tables.push(table)
  }

  const optional = <T>(path: string): T | undefined => {
    const text = files.get(path)
    return text === undefined ? undefined : parseJson<T>(text, path, diagnostics)
  }

  const relationshipsFile = optional<unknown>('relationships.json')
  const rawRelations = relationshipItems(relationshipsFile)
  const relations = rawRelations.map(normalizeRelationship).filter((item): item is Relationship => Boolean(item))
  if (relations.length < rawRelations.length) {
    diagnostics.push({
      severity: 'warning',
      path: 'relationships.json',
      message: `${rawRelations.length - relations.length} 件のリレーションを読み取れませんでした（from / to の table と columns が必要です）。`,
    })
  }
  const bundle = normalizeBundle({
    catalog: manifest,
    tables,
    lineage: optional<Lineage>('lineage.json'),
    relationships: resolveTableKeys(relations, tables),
    glossary: optional<Glossary>('glossary.json'),
    assets: optional<Assets>('assets.json'),
  })

  const snapshots: Record<string, CatalogBundle> = {}
  for (const [path, text] of files) {
    const match = /^revisions\/([^/]+)\.json$/.exec(path)
    if (!match || match[1] === 'index') continue
    const snapshot = parseJson<Partial<CatalogBundle>>(text, path, diagnostics)
    if (snapshot?.catalog) snapshots[match[1]] = normalizeBundle(snapshot)
  }

  const index = optional<{ revisions?: RevisionIndexEntry[] }>('revisions/index.json')
  const revisions = asArray<RevisionIndexEntry>(index?.revisions)
  if (!revisions.some((revision) => revision.id === manifest.revision?.id) && manifest.revision) {
    revisions.push({ ...manifest.revision })
  }
  revisions.sort((a, b) => a.number - b.number)
  // The live files are always the newest view of the current revision.
  if (manifest.revision?.id) snapshots[manifest.revision.id] = bundle

  diagnostics.push(...lintBundle(bundle))
  return { ...bundle, revisions, snapshots, changelog: files.get('CHANGELOG.md'), diagnostics }
}
