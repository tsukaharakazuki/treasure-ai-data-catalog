import { useMemo, useState } from 'react'
import { ErDiagram } from '../components/ErDiagram'
import { LineageGraph, NODE_TYPE_LABEL } from '../components/LineageGraph'
import { tableKey } from '../core/load'
import { inferRelationships } from '../core/relations'
import { href, navigate, type Route } from '../router'
import type { LineageNodeType, LoadedCatalog } from '../types/catalog'

const HIDEABLE: LineageNodeType[] = ['source', 'workflow', 'saved_query', 'parent_segment', 'segment', 'activation', 'external']

export function LineageView({ catalog, route }: { catalog: LoadedCatalog; route: Route }) {
  const focus = route.params.get('focus') ?? undefined
  const depthParam = route.params.get('depth')
  const depth = depthParam ? Number(depthParam) : undefined
  const [collapse, setCollapse] = useState(false)
  const [hidden, setHidden] = useState<LineageNodeType[]>([])
  const present = useMemo(() => new Set(catalog.lineage.nodes.map((node) => node.type)), [catalog])
  const focusNode = catalog.lineage.nodes.find((node) => node.id === focus)

  const toggle = (type: LineageNodeType) => setHidden((current) => current.includes(type) ? current.filter((item) => item !== type) : [...current, type])

  return (
    <div className="graph-page">
      <div className="toolbar">
        <label>
          中心
          <select value={focus ?? ''} onChange={(event) => navigate('lineage', undefined, { focus: event.target.value || undefined, depth: depthParam ?? undefined })}>
            <option value="">全体</option>
            {catalog.lineage.nodes.map((node) => <option key={node.id} value={node.id}>{NODE_TYPE_LABEL[node.type]}: {node.label}</option>)}
          </select>
        </label>
        {focus && (
          <label>
            深さ
            <select value={depthParam ?? ''} onChange={(event) => navigate('lineage', undefined, { focus, depth: event.target.value || undefined })}>
              <option value="">制限なし</option>
              {[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={collapse} onChange={(event) => setCollapse(event.target.checked)} />
          Workflow / Saved Query を矢印にまとめる
        </label>
        <div className="toggles">
          {HIDEABLE.filter((type) => present.has(type)).map((type) => (
            <button type="button" key={type} className={`toggle type-${type}${hidden.includes(type) ? ' off' : ''}`} onClick={() => toggle(type)}>
              {NODE_TYPE_LABEL[type]}
            </button>
          ))}
        </div>
        {focusNode?.type === 'table' && focusNode.ref && <a className="button ghost small" href={href('tables', focusNode.ref)}>テーブル詳細</a>}
      </div>
      <div className="graph-frame full">
        <LineageGraph
          lineage={catalog.lineage}
          tables={catalog.tables}
          focus={focus}
          depth={depth}
          collapseProcesses={collapse}
          hiddenTypes={hidden}
          exportName={`lineage-${catalog.catalog.name}-${catalog.catalog.revision.id}`}
        />
      </div>
      <p className="legend">
        テーブルをクリックすると詳細へ、その他のノードをクリックするとそのノードを中心に表示します。点線は推定・未解決の流れです。
      </p>
    </div>
  )
}

export function ErView({ catalog, route }: { catalog: LoadedCatalog; route: Route }) {
  const focus = route.params.get('focus') ?? undefined
  const [showIsolated, setShowIsolated] = useState(false)
  const [showAllColumns, setShowAllColumns] = useState(false)
  const explicit = catalog.relationships
  const [includeInferred, setIncludeInferred] = useState(explicit.length === 0)
  const inferred = useMemo(() => inferRelationships(catalog), [catalog])
  const relationships = useMemo(() => (includeInferred ? [...explicit, ...inferred] : explicit), [explicit, inferred, includeInferred])
  return (
    <div className="graph-page">
      <div className="toolbar">
        <label>
          中心テーブル
          <select value={focus ?? ''} onChange={(event) => navigate('er', undefined, { focus: event.target.value || undefined })}>
            <option value="">全体</option>
            {catalog.tables.map((table) => <option key={tableKey(table)} value={tableKey(table)}>{table.logical_name ?? table.name}（{tableKey(table)}）</option>)}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={showIsolated} onChange={(event) => setShowIsolated(event.target.checked)} disabled={Boolean(focus)} />
          リレーションのないテーブルも表示
        </label>
        <label className="check" title="同じID体系のカラムを持つテーブル同士を、一致率を検証していない推定リレーションとして点線で表示します">
          <input type="checkbox" checked={includeInferred} onChange={(event) => setIncludeInferred(event.target.checked)} disabled={inferred.length === 0} />
          ID体系から推定したリレーションも表示（{inferred.length}）
        </label>
        <span className="muted small">登録済み {explicit.length} 件</span>
        <label className="check">
          <input type="checkbox" checked={showAllColumns} onChange={(event) => setShowAllColumns(event.target.checked)} />
          全カラムを表示
        </label>
        {focus && <a className="button ghost small" href={href('tables', focus, { tab: 'schema' })}>テーブル詳細</a>}
      </div>
      <div className="graph-frame full">
        <ErDiagram tables={catalog.tables} relationships={relationships} focus={focus} showIsolated={showIsolated} showAllColumns={showAllColumns} />
      </div>
      <p className="legend">矢印は参照される側（親）→ 参照する側（子）。PK = 主キー、FK = 結合キー、点線は推定のリレーションです。テーブルをクリックするとそのテーブルを中心に表示します。</p>
    </div>
  )
}
