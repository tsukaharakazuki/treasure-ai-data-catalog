import { useMemo } from 'react'
import { href } from '../router'
import { ExternalLink, Section, TableLink, formatNumber } from '../components/common'
import { tableKey } from '../core/load'
import type { LoadedCatalog } from '../types/catalog'

export function Overview({ catalog }: { catalog: LoadedCatalog }) {
  const stats = useMemo(() => {
    const columns = catalog.tables.flatMap((table) => table.columns)
    const named = columns.filter((column) => column.logical_name).length
    const review = columns.filter((column) => column.logical_name_status === 'needs_review').length
    const described = catalog.tables.filter((table) => table.description).length
    const withSamples = catalog.tables.filter((table) => table.samples?.rows.length).length
    const withQueries = catalog.tables.filter((table) => table.sample_queries?.length).length
    return { columns: columns.length, named, review, described, withSamples, withQueries }
  }, [catalog])

  const databases = useMemo(() => {
    const groups = new Map<string, number>()
    for (const table of catalog.tables) groups.set(table.database, (groups.get(table.database) ?? 0) + 1)
    return [...groups.entries()]
  }, [catalog])

  const reviewColumns = useMemo(
    () => catalog.tables.flatMap((table) => table.columns
      .filter((column) => column.logical_name_status === 'needs_review' || !column.logical_name)
      .map((column) => ({ key: tableKey(table), column }))).slice(0, 30),
    [catalog],
  )

  const { catalog: manifest } = catalog
  const pct = (value: number, total: number) => (total ? `${Math.round((value / total) * 100)}%` : '-')
  const latest = catalog.revisions.at(-1)

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">{manifest.customer}{manifest.service ? ` / ${manifest.service}` : ''}</p>
          <h2>{manifest.display_name ?? manifest.name}</h2>
          {manifest.description && <p className="muted">{manifest.description}</p>}
        </div>
        <div className="page-meta">
          <span className="badge strong">{manifest.revision.id}</span>
          <span className="muted">{manifest.revision.generated_at?.slice(0, 16).replace('T', ' ')}</span>
          <ExternalLink url={manifest.td?.console_base_url} />
        </div>
      </header>

      <div className="kpis">
        <a className="kpi" href={href('tables')}><span>テーブル</span><strong>{formatNumber(catalog.tables.length)}</strong></a>
        <div className="kpi"><span>カラム</span><strong>{formatNumber(stats.columns)}</strong></div>
        <div className="kpi"><span>論理名の付与率</span><strong>{pct(stats.named, stats.columns)}</strong><em>要確認 {stats.review}</em></div>
        <div className="kpi"><span>説明の記入率</span><strong>{pct(stats.described, catalog.tables.length)}</strong></div>
        <a className="kpi" href={href('lineage')}><span>リネージ</span><strong>{formatNumber(catalog.lineage.edges.length)}</strong><em>エッジ</em></a>
        <a className="kpi" href={href('er')}><span>リレーション</span><strong>{formatNumber(catalog.relationships.length)}</strong></a>
        <a className="kpi" href={href('glossary')}><span>用語 / 処理事例</span><strong>{catalog.glossary.terms.length} / {catalog.glossary.recipes.length}</strong></a>
        <a className="kpi" href={href('revisions')}><span>リビジョン</span><strong>{catalog.revisions.length}</strong><em>{latest?.note}</em></a>
      </div>

      <div className="grid-2">
        <Section title="データベース">
          <ul className="plain-list">
            {databases.map(([database, count]) => (
              <li key={database}><a href={href('tables', undefined, { db: database })}><code>{database}</code></a><span className="muted">{count} テーブル</span></li>
            ))}
          </ul>
        </Section>
        <Section title="アセット">
          <ul className="plain-list">
            <li><a href={href('assets', 'sources')}>Source</a><span className="muted">{catalog.assets.sources.length}</span></li>
            <li><a href={href('assets', 'workflows')}>Workflow</a><span className="muted">{catalog.assets.workflows.length}</span></li>
            <li><a href={href('assets', 'saved_queries')}>Saved Query</a><span className="muted">{catalog.assets.saved_queries.length}</span></li>
            <li><a href={href('assets', 'parent_segments')}>Parent Segment</a><span className="muted">{catalog.assets.parent_segments.length}</span></li>
            <li><a href={href('ids')}>ID体系</a><span className="muted">{catalog.glossary.id_systems.length}</span></li>
          </ul>
        </Section>
      </div>

      <div className="grid-2">
        <Section title="カバレッジ">
          <ul className="plain-list">
            <li><span>サンプルデータあり</span><span className="muted">{stats.withSamples} / {catalog.tables.length}</span></li>
            <li><span>サンプルクエリあり</span><span className="muted">{stats.withQueries} / {catalog.tables.length}</span></li>
            <li><span>対象範囲（scope）</span><span className="muted">{[
              manifest.scope?.parent_segments?.length ? `PS ${manifest.scope.parent_segments.length}` : '',
              manifest.scope?.workflow_projects?.length ? `WF ${manifest.scope.workflow_projects.length}` : '',
              manifest.scope?.saved_queries?.length ? `SQ ${manifest.scope.saved_queries.length}` : '',
              manifest.scope?.sources?.length ? `Source ${manifest.scope.sources.length}` : '',
            ].filter(Boolean).join(' / ') || '-'}</span></li>
          </ul>
        </Section>
        <Section title="論理名が要確認・未設定のカラム">
          {reviewColumns.length === 0 ? <p className="muted">すべて確定しています。</p> : (
            <ul className="plain-list">
              {reviewColumns.map(({ key, column }) => (
                <li key={`${key}.${column.name}`}>
                  <TableLink tableKey={key} />
                  <span><code>{column.name}</code> {column.logical_name ?? '（未設定）'}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {catalog.diagnostics.some((item) => item.severity !== 'info') && (
        <Section title="読み込み時の警告">
          <ul className="diagnostics">
            {catalog.diagnostics.filter((item) => item.severity !== 'info').map((item, index) => (
              <li key={index} className={item.severity}><strong>{item.path}</strong> {item.message}</li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
