import { useMemo, useState } from 'react'
import { Search, Table2 } from 'lucide-react'
import { tableKey } from '../core/load'
import { tableMatches } from '../core/search'
import { neighbours, processesTouching, tableNodeId } from '../core/lineage'
import { href, navigate, type Route } from '../router'
import {
  ConfidenceBadge,
  Empty,
  ExternalLink,
  PiiBadge,
  Section,
  SqlBlock,
  TableLink,
  formatLastUpdated,
  formatNumber,
  formatValue,
} from '../components/common'
import { LineageGraph } from '../components/LineageGraph'
import type { CatalogTable, LoadedCatalog } from '../types/catalog'

type Tab = 'overview' | 'schema' | 'samples' | 'queries' | 'lineage'
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: '概要' },
  { id: 'schema', label: 'スキーマ' },
  { id: 'samples', label: 'サンプルデータ' },
  { id: 'queries', label: 'サンプルクエリ' },
  { id: 'lineage', label: 'リネージ' },
]

export function TablesView({ catalog, route }: { catalog: LoadedCatalog; route: Route }) {
  const [query, setQuery] = useState('')
  const database = route.params.get('db') ?? ''
  const databases = useMemo(() => [...new Set(catalog.tables.map((table) => table.database))], [catalog])
  const idSystemNames = useMemo(() => new Map(catalog.glossary.id_systems.map((system) => [system.id, system.name])), [catalog])
  const filtered = useMemo(
    () => catalog.tables.filter((table) => (!database || table.database === database) && tableMatches(table, query, idSystemNames)),
    [catalog, database, query, idSystemNames],
  )
  const selected = catalog.tables.find((table) => tableKey(table) === route.id)

  return (
    <div className="split">
      <aside className="list-pane">
        <div className="list-tools">
          <label className="search-input">
            <Search size={14} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="物理名・論理名・カラムで絞り込み" />
          </label>
          <select value={database} onChange={(event) => navigate('tables', route.id, { db: event.target.value })}>
            <option value="">すべてのDB</option>
            {databases.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          {query.trim() && (
            <a className="explore-link" href={href('explore', undefined, { q: query })}>
              「{query}」に一致するカラムを横断表示 →
            </a>
          )}
          <span className="muted small">{filtered.length} / {catalog.tables.length} テーブル</span>
        </div>
        <ul className="table-list">
          {filtered.map((table) => {
            const key = tableKey(table)
            return (
              <li key={key}>
                <a className={key === route.id ? 'active' : ''} href={href('tables', key, { db: database || undefined })}>
                  <span className="table-list-title"><Table2 size={13} /> {table.logical_name ?? table.name}</span>
                  <code>{key}</code>
                  {table.kind && <span className={`kind kind-${table.kind}`}>{table.kind}</span>}
                </a>
              </li>
            )
          })}
          {filtered.length === 0 && <li className="muted pad">該当するテーブルがありません</li>}
        </ul>
      </aside>
      <div className="detail-pane">
        {selected ? <TableDetail key={tableKey(selected)} table={selected} catalog={catalog} initialTab={(route.params.get('tab') as Tab) ?? 'overview'} highlight={route.params.get('column') ?? undefined} />
          : <Empty>左の一覧からテーブルを選択してください。</Empty>}
      </div>
    </div>
  )
}

function TableDetail({ table, catalog, initialTab, highlight }: { table: CatalogTable; catalog: LoadedCatalog; initialTab: Tab; highlight?: string }) {
  const [tab, setTab] = useState<Tab>(TABS.some((item) => item.id === initialTab) ? initialTab : 'overview')
  const key = tableKey(table)
  const idSystems = new Map(catalog.glossary.id_systems.map((system) => [system.id, system]))

  const related = useMemo(() => {
    const nodeId = tableNodeId(key)
    const { upstream, downstream } = neighbours(catalog.lineage, nodeId)
    const { readers, writers } = processesTouching(catalog.lineage, nodeId)
    const relations = catalog.relationships.filter((relation) => relation.from.table === key || relation.to.table === key)
    const recipes = catalog.glossary.recipes
      .map((recipe) => ({ recipe, variant: recipe.variants.find((variant) => variant.table === key) }))
      .filter((item) => item.variant)
    const rules = catalog.glossary.rules.filter((rule) => rule.applies_to?.includes(key))
    const terms = catalog.glossary.terms.filter((term) => term.related_tables?.includes(key))
    return { upstream, downstream, readers, writers, relations, recipes, rules, terms }
  }, [catalog, key])

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow"><code>{key}</code>{table.kind && <span className={`kind kind-${table.kind}`}>{table.kind}</span>}</p>
          <h2>{table.logical_name ?? table.name}</h2>
          {table.description && <p className="lead-small">{table.description}</p>}
        </div>
        <div className="page-meta">
          <a className="button ghost small" href={href('lineage', undefined, { focus: tableNodeId(key) })}>リネージ</a>
          <a className="button ghost small" href={href('er', undefined, { focus: key })}>ER図</a>
          <ExternalLink url={table.console_url} />
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((item) => (
          <button type="button" key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>
            {item.label}
            {item.id === 'schema' && <span className="count">{table.columns.length}</span>}
            {item.id === 'queries' && <span className="count">{table.sample_queries?.length ?? 0}</span>}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <>
          <div className="facts">
            <div><span>更新頻度</span><strong>{table.update_frequency ?? '-'}</strong></div>
            <div><span>行数</span><strong>{formatNumber(table.row_count)}</strong></div>
            <div><span>最終更新（MAX(time)）</span><strong>{formatLastUpdated(table, catalog.catalog.td?.timezone)}</strong></div>
            <div><span>主キー</span><strong>{table.primary_key?.join(', ') ?? '-'}</strong></div>
          </div>
          {(table.tags?.length ?? 0) > 0 && <div className="tags">{table.tags?.map((tag) => <span key={tag} className="tag">{tag}</span>)}</div>}
          <div className="grid-2">
            <Section title="利用用途">
              {table.usage?.length ? <ul className="bullets">{table.usage.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="muted">未記入</p>}
              {table.notes && <p className="note">{table.notes}</p>}
            </Section>
            <Section title="データの流れ">
              <dl className="flow">
                <dt>上流</dt>
                <dd>{related.upstream.length ? related.upstream.map((node) => <NodeChip key={node.id} id={node.id} label={node.label} />) : '-'}</dd>
                <dt>更新処理</dt>
                <dd>{related.writers.length ? related.writers.map((node) => <NodeChip key={node.id} id={node.id} label={node.label} />) : '-'}</dd>
                <dt>参照処理</dt>
                <dd>{related.readers.length ? related.readers.map((node) => <NodeChip key={node.id} id={node.id} label={node.label} />) : '-'}</dd>
                <dt>下流</dt>
                <dd>{related.downstream.length ? related.downstream.map((node) => <NodeChip key={node.id} id={node.id} label={node.label} />) : '-'}</dd>
              </dl>
            </Section>
          </div>
          <div className="grid-2">
            <Section title="結合できるテーブル">
              {related.relations.length ? (
                <ul className="plain-list">
                  {related.relations.map((relation, index) => {
                    const mine = relation.from.table === key ? relation.from : relation.to
                    const other = relation.from.table === key ? relation.to : relation.from
                    return (
                      <li key={index}>
                        <span><code>{mine.columns.join(', ')}</code> → <TableLink tableKey={other.table} /> <code>{other.columns.join(', ')}</code></span>
                        <span className="muted">{relation.cardinality ?? ''} {relation.evidence ?? ''}</span>
                      </li>
                    )
                  })}
                </ul>
              ) : <p className="muted">登録なし</p>}
            </Section>
            <Section title="このテーブルの処理事例・ルール">
              {related.recipes.length === 0 && related.rules.length === 0 && related.terms.length === 0 && <p className="muted">登録なし</p>}
              <ul className="plain-list">
                {related.recipes.map(({ recipe, variant }) => (
                  <li key={recipe.id}>
                    <a href={href('glossary', recipe.id)}>{recipe.instruction}</a>
                    <code>{variant?.expression}</code>
                  </li>
                ))}
                {related.rules.map((rule) => <li key={rule.title}><strong>{rule.title}</strong><span className="muted">{rule.description}</span></li>)}
                {related.terms.map((term) => <li key={term.term}><a href={href('glossary', undefined, { term: term.term })}>{term.term}</a><span className="muted">{term.definition}</span></li>)}
              </ul>
            </Section>
          </div>
        </>
      )}

      {tab === 'schema' && (
        <div className="table-scroll">
          <table className="data-table schema">
            <thead>
              <tr><th>#</th><th>物理名</th><th>論理名</th><th>型</th><th>説明</th><th>ID体系 / 区分</th><th>コード値</th></tr>
            </thead>
            <tbody>
              {table.columns.map((column, index) => (
                <tr key={column.name} className={column.name === highlight ? 'highlight' : ''}>
                  <td className="muted">{index + 1}</td>
                  <td>
                    <code>{column.name}</code>
                    {(column.is_primary_key || table.primary_key?.includes(column.name)) && <span className="badge strong">PK</span>}
                    {column.is_partition_key && <span className="badge soft">partition</span>}
                  </td>
                  <td>{column.logical_name ?? <span className="muted">未設定</span>} <ConfidenceBadge value={column.logical_name_status} /></td>
                  <td><code className="type">{column.type}</code></td>
                  <td>
                    {column.description}
                    {column.stats && (
                      <div className="stats">
                        {column.stats.pattern && <span>形式: {column.stats.pattern}</span>}
                        {column.stats.null_ratio !== undefined && <span>NULL率 {(column.stats.null_ratio * 100).toFixed(1)}%</span>}
                        {column.stats.distinct_approx !== undefined && <span>種類 ≈{formatNumber(column.stats.distinct_approx)}</span>}
                      </div>
                    )}
                  </td>
                  <td>
                    {column.id_system && <a className="badge id" href={href('ids', column.id_system)}>{idSystems.get(column.id_system)?.name ?? column.id_system}</a>}
                    <PiiBadge value={column.pii} />
                  </td>
                  <td className="values">
                    {column.values && Object.entries(column.values).map(([code, label]) => <span key={code}><code>{code}</code> {label}</span>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'samples' && (
        table.samples?.rows.length ? (
          <>
            <p className="muted small">
              {table.samples.captured_at && `取得日 ${table.samples.captured_at}。`}
              {table.samples.masked_columns?.length ? `マスク済み: ${table.samples.masked_columns.join(', ')}。` : ''}
              {table.samples.note}
            </p>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>{table.columns.map((column) => <th key={column.name}><code>{column.name}</code><span>{column.logical_name}</span></th>)}</tr>
                </thead>
                <tbody>
                  {table.samples.rows.map((row, index) => (
                    <tr key={index}>{table.columns.map((column) => <td key={column.name} className={row[column.name] === null || row[column.name] === undefined ? 'null' : ''}>{formatValue(row[column.name])}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : <Empty>サンプルデータは登録されていません。</Empty>
      )}

      {tab === 'queries' && (
        table.sample_queries?.length
          ? <div className="stack">{table.sample_queries.map((query) => <SqlBlock key={query.title} {...query} />)}</div>
          : <Empty>サンプルクエリは登録されていません。</Empty>
      )}

      {tab === 'lineage' && (
        <div className="graph-frame">
          <LineageGraph lineage={catalog.lineage} tables={catalog.tables} focus={tableNodeId(key)} depth={2} exportName={`lineage-${key}`} />
        </div>
      )}
    </div>
  )
}

function NodeChip({ id, label }: { id: string; label: string }) {
  const link = id.startsWith('table:') ? href('tables', id.slice('table:'.length)) : href('lineage', undefined, { focus: id })
  return <a className="chip" href={link}>{label}</a>
}
