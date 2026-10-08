/**
 * Treasure AI Data Catalog — format v1.
 * The normative description lives in docs/CATALOG_FORMAT.md; keep both in sync.
 */

export const CATALOG_FORMAT = 'treasure-ai-data-catalog'
export const CATALOG_VERSION = 1

export type Confidence = 'confirmed' | 'inferred' | 'needs_review'
export type LineageConfidence = 'exact' | 'inferred' | 'unresolved'
export type PiiLevel = 'none' | 'identifier' | 'personal' | 'sensitive'

export interface CatalogRevision {
  id: string
  number: number
  generated_at: string
  generated_by?: string
  note?: string
}

export interface CatalogManifest {
  format: typeof CATALOG_FORMAT
  version: typeof CATALOG_VERSION
  /** Slug used for the generated skill: `<name>-data-catalog`. */
  name: string
  display_name?: string
  customer?: string
  service?: string
  /** BCP 47 language used for logical names and descriptions (e.g. `ja`). */
  language: string
  revision: CatalogRevision
  td?: {
    site?: string
    account_id?: string
    console_base_url?: string
    /** IANA time zone used to display timestamps. Default Asia/Tokyo. */
    timezone?: string
  }
  scope?: {
    databases?: string[]
    parent_segments?: string[]
    workflow_projects?: string[]
    saved_queries?: string[]
    sources?: string[]
    inputs?: string[]
  }
  privacy?: {
    sample_rows_max?: number
    masking_policy?: string
  }
  description?: string
}

export interface ColumnStats {
  null_ratio?: number
  distinct_approx?: number
  min_length?: number
  max_length?: number
  /** Human readable pattern summary, e.g. `10桁の数字`. */
  pattern?: string
}

export interface CatalogColumn {
  name: string
  type: string
  logical_name?: string
  logical_name_status?: Confidence
  description?: string
  nullable?: boolean
  pii?: PiiLevel
  /** Refers to glossary.id_systems[].id */
  id_system?: string
  /** Allowed values / code definitions, e.g. { "1": "会員", "0": "非会員" } */
  values?: Record<string, string>
  stats?: ColumnStats
  is_primary_key?: boolean
  is_partition_key?: boolean
}

export interface SampleQuery {
  title: string
  description?: string
  engine?: 'trino' | 'hive'
  sql: string
}

export interface CatalogTable {
  database: string
  name: string
  logical_name?: string
  kind?: 'source' | 'derived' | 'temporary' | 'master' | 'segment_output' | 'mart' | string
  description?: string
  usage?: string[]
  tags?: string[]
  /** @deprecated Not collected or shown any more; kept so older catalogs still load. */
  owner?: string
  update_frequency?: string
  /** Result of SELECT COUNT(*) at catalog build time. */
  row_count?: number
  /** MAX(time) of the table (UNIX seconds). Shown as yyyy-MM-dd HH:mm:ss in td.timezone. */
  last_updated_unixtime?: number
  /** Pre-formatted fallback when there is no time column (yyyy-MM-dd HH:mm:ss). */
  last_updated?: string
  console_url?: string
  primary_key?: string[]
  columns: CatalogColumn[]
  samples?: {
    rows: Record<string, unknown>[]
    masked_columns?: string[]
    captured_at?: string
    note?: string
  }
  sample_queries?: SampleQuery[]
  notes?: string
}

export type LineageNodeType =
  | 'table'
  | 'source'
  | 'workflow'
  | 'saved_query'
  | 'parent_segment'
  | 'segment'
  | 'activation'
  | 'external'

export interface LineageNode {
  id: string
  type: LineageNodeType
  label: string
  /** `db.table` for table nodes, asset id otherwise. */
  ref?: string
  description?: string
  console_url?: string
}

export interface LineageEdge {
  from: string
  to: string
  type?: 'import' | 'transform' | 'reads' | 'writes' | 'feeds' | 'activates' | string
  confidence?: LineageConfidence
  note?: string
}

export interface Lineage {
  nodes: LineageNode[]
  edges: LineageEdge[]
}

export type Cardinality = 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many'

export interface Relationship {
  id?: string
  from: { table: string; columns: string[] }
  to: { table: string; columns: string[] }
  cardinality?: Cardinality
  confidence?: Confidence
  evidence?: string
  id_system?: string
}

export interface GlossaryTerm {
  term: string
  aliases?: string[]
  category?: string
  definition: string
  related_tables?: string[]
  related_columns?: string[]
}

export interface IdSystem {
  id: string
  name: string
  description?: string
  pattern?: string
  length?: number | string
  example_masked?: string
  columns?: string[]
  status?: Confidence
  note?: string
}

export interface RecipeVariant {
  table: string
  expression: string
  sql?: string
  conditions?: string
  notes?: string
}

export interface Recipe {
  id: string
  instruction: string
  aliases?: string[]
  term?: string
  description?: string
  variants: RecipeVariant[]
}

export interface BusinessRule {
  title: string
  description: string
  applies_to?: string[]
}

export interface Glossary {
  terms: GlossaryTerm[]
  id_systems: IdSystem[]
  recipes: Recipe[]
  rules: BusinessRule[]
}

export interface SourceAsset {
  id: string
  name: string
  connector_type?: string
  schedule?: string
  mode?: string
  target_tables?: string[]
  description?: string
  console_url?: string
}

export interface WorkflowAsset {
  id: string
  project: string
  workflow: string
  schedule?: string
  description?: string
  reads?: string[]
  writes?: string[]
  console_url?: string
}

export interface SavedQueryAsset {
  id: string
  name: string
  schedule?: string
  database?: string
  engine?: string
  description?: string
  sql?: string
  reads?: string[]
  writes?: string[]
  result_export?: string
  console_url?: string
}

export interface ParentSegmentAsset {
  id: string
  name: string
  master_table?: string
  attribute_tables?: string[]
  behavior_tables?: string[]
  output_database?: string
  description?: string
  console_url?: string
}

export interface Assets {
  sources: SourceAsset[]
  workflows: WorkflowAsset[]
  saved_queries: SavedQueryAsset[]
  parent_segments: ParentSegmentAsset[]
}

/** Everything that defines one revision of a catalog. Also the snapshot file shape. */
export interface CatalogBundle {
  catalog: CatalogManifest
  tables: CatalogTable[]
  lineage: Lineage
  relationships: Relationship[]
  glossary: Glossary
  assets: Assets
}

export interface RevisionIndexEntry extends CatalogRevision {
  summary?: Record<string, number>
}

export interface CatalogDiagnostic {
  severity: 'error' | 'warning' | 'info'
  message: string
  path?: string
}

export interface LoadedCatalog extends CatalogBundle {
  revisions: RevisionIndexEntry[]
  snapshots: Record<string, CatalogBundle>
  changelog?: string
  diagnostics: CatalogDiagnostic[]
}
