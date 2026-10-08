import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { normalizeText } from '../core/search'
import { href, type Route } from '../router'
import { ConfidenceBadge, Empty, ExternalLink, Section, SqlBlock, TableLink } from '../components/common'
import type { LoadedCatalog } from '../types/catalog'

const contains = (query: string, ...values: (string | undefined)[]) =>
  !query || values.some((value) => value && normalizeText(value).includes(query))

export function GlossaryView({ catalog, route }: { catalog: LoadedCatalog; route: Route }) {
  const [query, setQuery] = useState(route.params.get('term') ?? '')
  const normalized = normalizeText(query.trim())
  const logical = useMemo(() => new Map(catalog.tables.map((table) => [`${table.database}.${table.name}`, table.logical_name])), [catalog])
  const { terms, recipes, rules } = catalog.glossary
  const selectedRecipe = recipes.find((recipe) => recipe.id === route.id)
  const visibleRecipes = selectedRecipe ? [selectedRecipe] : recipes.filter((recipe) => contains(normalized, recipe.instruction, recipe.term, ...(recipe.aliases ?? [])))
  const visibleTerms = terms.filter((term) => contains(normalized, term.term, term.definition, term.category, ...(term.aliases ?? [])))

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h2>社内用語・処理事例集</h2>
          <p className="muted">同じ指示でも、クエリするテーブルによって計算方法が変わります。テーブルごとの正しい処理をここで確認できます。</p>
        </div>
        <label className="search-input wide">
          <Search size={14} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例: 売上、購入者、アクティブ会員" />
        </label>
      </header>

      <Section title={`処理事例（${visibleRecipes.length}）`} actions={selectedRecipe && <a className="button ghost small" href={href('glossary')}>すべて表示</a>}>
        {visibleRecipes.length === 0 && <p className="muted">該当する処理事例はありません。</p>}
        <div className="recipes">
          {visibleRecipes.map((recipe) => (
            <article className="recipe" key={recipe.id} id={`recipe-${recipe.id}`}>
              <header>
                <a href={href('glossary', recipe.id)}><h3>「{recipe.instruction}」</h3></a>
                {recipe.aliases?.length ? <p className="muted small">別の言い方: {recipe.aliases.join(' / ')}</p> : null}
                {recipe.description && <p>{recipe.description}</p>}
              </header>
              <table className="data-table recipe-table">
                <thead><tr><th>テーブル</th><th>処理</th><th>条件</th><th>注意</th></tr></thead>
                <tbody>
                  {recipe.variants.map((variant) => (
                    <tr key={variant.table}>
                      <td><TableLink tableKey={variant.table} label={logical.get(variant.table)} /></td>
                      <td><code className="expression">{variant.expression}</code></td>
                      <td>{variant.conditions}</td>
                      <td>{variant.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {recipe.variants.filter((variant) => variant.sql).map((variant) => (
                <SqlBlock key={variant.table} sql={variant.sql ?? ''} title={`${logical.get(variant.table) ?? variant.table} の場合`} engine="trino" />
              ))}
            </article>
          ))}
        </div>
      </Section>

      <Section title={`用語（${visibleTerms.length}）`}>
        {visibleTerms.length === 0 ? <p className="muted">該当する用語はありません。</p> : (
          <table className="data-table">
            <thead><tr><th>用語</th><th>分類</th><th>定義</th><th>関連</th></tr></thead>
            <tbody>
              {visibleTerms.map((term) => (
                <tr key={term.term}>
                  <td><strong>{term.term}</strong>{term.aliases?.length ? <div className="muted small">{term.aliases.join(' / ')}</div> : null}</td>
                  <td>{term.category}</td>
                  <td>{term.definition}</td>
                  <td>
                    {term.related_tables?.map((key) => <TableLink key={key} tableKey={key} />)}
                    {term.related_columns?.map((column) => <code key={column} className="block">{column}</code>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title={`業務ルール（${rules.length}）`}>
        {rules.length === 0 ? <p className="muted">登録なし</p> : (
          <ul className="plain-list">
            {rules.map((rule) => (
              <li key={rule.title}>
                <span><strong>{rule.title}</strong> — {rule.description}</span>
                <span>{rule.applies_to?.map((key) => <TableLink key={key} tableKey={key} />)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}

export function IdSystemsView({ catalog, route }: { catalog: LoadedCatalog; route: Route }) {
  const systems = catalog.glossary.id_systems
  const usage = useMemo(() => {
    const map = new Map<string, { table: string; column: string; logical?: string }[]>()
    for (const table of catalog.tables) {
      for (const column of table.columns) {
        if (!column.id_system) continue
        const list = map.get(column.id_system) ?? []
        list.push({ table: `${table.database}.${table.name}`, column: column.name, logical: column.logical_name })
        map.set(column.id_system, list)
      }
    }
    return map
  }, [catalog])

  if (!systems.length) return <div className="page"><Empty>ID体系は登録されていません。</Empty></div>

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h2>ID体系</h2>
          <p className="muted">社内に複数ある会員ID・顧客IDなどの体系と、それぞれを持つカラムです。体系の異なるIDは直接結合できません。</p>
        </div>
      </header>
      <div className="id-grid">
        {systems.map((system) => (
          <article key={system.id} className={`id-card${system.id === route.id ? ' focused' : ''}`} id={`id-${system.id}`}>
            <header>
              <h3>{system.name}</h3>
              <code>{system.id}</code>
              <ConfidenceBadge value={system.status} />
            </header>
            {system.description && <p>{system.description}</p>}
            <dl className="facts-inline">
              {system.pattern && <><dt>形式</dt><dd><code>{system.pattern}</code></dd></>}
              {system.length !== undefined && <><dt>桁数</dt><dd>{system.length}</dd></>}
              {system.example_masked && <><dt>例</dt><dd><code>{system.example_masked}</code></dd></>}
            </dl>
            {system.note && <p className="note">{system.note}</p>}
            <ul className="plain-list">
              {(usage.get(system.id) ?? []).map((item) => (
                <li key={`${item.table}.${item.column}`} className="id-column">
                  <a href={href('tables', item.table, { tab: 'schema', column: item.column })}>
                    <code className="id-column-name">{item.column}</code>
                    <code className="id-column-table">{item.table}</code>
                  </a>
                  {item.logical && <span className="muted">{item.logical}</span>}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </div>
  )
}

type AssetTab = 'sources' | 'workflows' | 'saved_queries' | 'parent_segments'
const ASSET_TABS: { id: AssetTab; label: string }[] = [
  { id: 'sources', label: 'Source' },
  { id: 'workflows', label: 'Workflow' },
  { id: 'saved_queries', label: 'Saved Query' },
  { id: 'parent_segments', label: 'Parent Segment' },
]

const tableList = (keys?: string[]) => keys?.length ? keys.map((key) => <TableLink key={key} tableKey={key} />) : <span className="muted">-</span>

export function AssetsView({ catalog, route }: { catalog: LoadedCatalog; route: Route }) {
  const tab: AssetTab = ASSET_TABS.some((item) => item.id === route.id) ? (route.id as AssetTab) : 'sources'
  const { sources, workflows, saved_queries: savedQueries, parent_segments: parentSegments } = catalog.assets
  const lineageLink = (id: string) => <a className="button ghost small" href={href('lineage', undefined, { focus: id })}>リネージ</a>

  return (
    <div className="page">
      <header className="page-head"><div><h2>アセット</h2><p className="muted">カタログの対象になった Treasure Data の要素です。</p></div></header>
      <nav className="tabs">
        {ASSET_TABS.map((item) => (
          <a key={item.id} className={tab === item.id ? 'active' : ''} href={href('assets', item.id)}>
            {item.label}<span className="count">{catalog.assets[item.id].length}</span>
          </a>
        ))}
      </nav>
      {tab === 'sources' && (sources.length ? (
        <table className="data-table">
          <thead><tr><th>名前</th><th>コネクタ</th><th>スケジュール</th><th>モード</th><th>取込先</th><th /></tr></thead>
          <tbody>{sources.map((item) => (
            <tr key={item.id}>
              <td><strong>{item.name}</strong>{item.description && <div className="muted small">{item.description}</div>}</td>
              <td><code>{item.connector_type}</code></td><td>{item.schedule}</td><td>{item.mode}</td>
              <td>{tableList(item.target_tables)}</td>
              <td>{lineageLink(`source:${item.id}`)}<ExternalLink url={item.console_url} /></td>
            </tr>
          ))}</tbody>
        </table>
      ) : <Empty>Source は登録されていません。</Empty>)}
      {tab === 'workflows' && (workflows.length ? (
        <table className="data-table">
          <thead><tr><th>Workflow</th><th>スケジュール</th><th>読み込み</th><th>書き込み</th><th /></tr></thead>
          <tbody>{workflows.map((item) => (
            <tr key={item.id}>
              <td><strong>{item.project}.{item.workflow}</strong>{item.description && <div className="muted small">{item.description}</div>}</td>
              <td>{item.schedule}</td><td>{tableList(item.reads)}</td><td>{tableList(item.writes)}</td>
              <td>{lineageLink(`workflow:${item.id}`)}<ExternalLink url={item.console_url} /></td>
            </tr>
          ))}</tbody>
        </table>
      ) : <Empty>Workflow は登録されていません。</Empty>)}
      {tab === 'saved_queries' && (savedQueries.length ? (
        <div className="stack">{savedQueries.map((item) => (
          <Section key={item.id} title={item.name} actions={<>{lineageLink(`saved_query:${item.id}`)}<ExternalLink url={item.console_url} /></>}>
            <div className="facts">
              <div><span>スケジュール</span><strong>{item.schedule ?? '-'}</strong></div>
              <div><span>DB / エンジン</span><strong>{item.database ?? '-'} / {item.engine ?? '-'}</strong></div>
              <div><span>読み込み</span><strong>{tableList(item.reads)}</strong></div>
              <div><span>書き込み</span><strong>{tableList(item.writes)}</strong></div>
            </div>
            {item.description && <p>{item.description}</p>}
            {item.sql && <SqlBlock sql={item.sql} engine={item.engine} />}
          </Section>
        ))}</div>
      ) : <Empty>Saved Query は登録されていません。</Empty>)}
      {tab === 'parent_segments' && (parentSegments.length ? (
        <table className="data-table">
          <thead><tr><th>名前</th><th>マスター</th><th>属性テーブル</th><th>ビヘイビア</th><th>出力DB</th><th /></tr></thead>
          <tbody>{parentSegments.map((item) => (
            <tr key={item.id}>
              <td><strong>{item.name}</strong>{item.description && <div className="muted small">{item.description}</div>}</td>
              <td>{tableList(item.master_table ? [item.master_table] : [])}</td>
              <td>{tableList(item.attribute_tables)}</td><td>{tableList(item.behavior_tables)}</td>
              <td><code>{item.output_database}</code></td>
              <td>{lineageLink(`parent_segment:${item.id}`)}<ExternalLink url={item.console_url} /></td>
            </tr>
          ))}</tbody>
        </table>
      ) : <Empty>Parent Segment は登録されていません。</Empty>)}
    </div>
  )
}
