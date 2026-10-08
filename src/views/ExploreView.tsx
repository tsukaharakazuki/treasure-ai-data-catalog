import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { searchColumns } from '../core/search'
import { href, type Route } from '../router'
import { ConfidenceBadge, CopyButton, PiiBadge } from '../components/common'
import type { LoadedCatalog } from '../types/catalog'

const MAX_ROWS = 500

const PII_OPTIONS = [
  { value: 'identifier', label: '識別子' },
  { value: 'personal', label: '個人情報' },
  { value: 'sensitive', label: '要配慮' },
  { value: 'none', label: '該当なし' },
]

const EXAMPLES = ['統合ID', '会員', '金額', '日時', 'メール']

/** Cross-table column explorer: type a word and see every matching column in one list. */
export function ExploreView({ catalog, route }: { catalog: LoadedCatalog; route: Route }) {
  const [query, setQuery] = useState(route.params.get('q') ?? '')
  const [database, setDatabase] = useState(route.params.get('db') ?? '')
  const [idSystem, setIdSystem] = useState(route.params.get('id') ?? '')
  const [pii, setPii] = useState('')

  const update = (next: string) => {
    setQuery(next)
    // Keep the query shareable without adding a history entry per keystroke.
    const params = new URLSearchParams()
    if (next) params.set('q', next)
    window.history.replaceState(null, '', `#/explore${params.toString() ? `?${params.toString()}` : ''}`)
  }

  const databases = useMemo(() => [...new Set(catalog.tables.map((table) => table.database))], [catalog])
  const idNames = useMemo(() => new Map(catalog.glossary.id_systems.map((system) => [system.id, system.name])), [catalog])
  const hasCondition = Boolean(query.trim() || database || idSystem || pii)

  const rows = useMemo(
    () => (hasCondition ? searchColumns(catalog, query, { database: database || undefined, idSystem: idSystem || undefined, pii: pii || undefined }) : []),
    [catalog, query, database, idSystem, pii, hasCondition],
  )
  const byTable = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>()
    for (const row of rows) {
      const entry = counts.get(row.tableKey) ?? { label: row.table.logical_name ?? row.table.name, count: 0 }
      entry.count += 1
      counts.set(row.tableKey, entry)
    }
    return [...counts.entries()]
  }, [rows])

  const tsv = useMemo(
    () => ['テーブル\t論理テーブル名\tカラム\t論理名\t型\tID体系\t説明',
      ...rows.map((row) => [row.tableKey, row.table.logical_name ?? '', row.column.name, row.column.logical_name ?? '', row.column.type,
        row.column.id_system ? idNames.get(row.column.id_system) ?? row.column.id_system : '', (row.column.description ?? '').replace(/\s+/g, ' ')].join('\t'))].join('\n'),
    [rows, idNames],
  )

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h2>テーブル探索</h2>
          <p className="muted">言葉を入れると、すべてのテーブルを横断して一致するカラムを一覧します。カラムの物理名・論理名・説明・ID体系・テーブル名が対象です。スペース区切りで AND 検索になります。</p>
        </div>
      </header>

      <div className="explore-tools">
        <label className="search-input explore-input">
          <Search size={16} />
          <input autoFocus value={query} onChange={(event) => update(event.target.value)} placeholder="例: 統合ID、会員 金額、ordered_at" />
        </label>
        <select value={database} onChange={(event) => setDatabase(event.target.value)}>
          <option value="">すべてのDB</option>
          {databases.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <select value={idSystem} onChange={(event) => setIdSystem(event.target.value)}>
          <option value="">すべてのID体系</option>
          {catalog.glossary.id_systems.map((system) => <option key={system.id} value={system.id}>{system.name}</option>)}
        </select>
        <select value={pii} onChange={(event) => setPii(event.target.value)}>
          <option value="">個人情報区分: すべて</option>
          {PII_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>

      {!hasCondition ? (
        <div className="explore-examples">
          <span className="muted">試してみる:</span>
          {EXAMPLES.map((example) => <button type="button" key={example} className="chip" onClick={() => update(example)}>{example}</button>)}
        </div>
      ) : (
        <>
          <div className="explore-summary">
            <strong>{byTable.length} テーブル / {rows.length} カラム</strong>
            {rows.length > 0 && <CopyButton text={tsv} label="一覧をコピー（TSV）" />}
          </div>
          {byTable.length > 0 && (
            <div className="explore-tables">
              {byTable.map(([key, entry]) => (
                <a key={key} className="chip" href={href('tables', key, { tab: 'schema' })} title={key}>
                  {entry.label} <span className="count">{entry.count}</span>
                </a>
              ))}
            </div>
          )}
          {rows.length === 0 ? <div className="empty">一致するカラムはありません。</div> : (
            <div className="table-scroll">
              <table className="data-table explore-table">
                <thead>
                  <tr><th>テーブル</th><th>カラム</th><th>論理名</th><th>型</th><th>ID体系 / 区分</th><th>説明</th></tr>
                </thead>
                <tbody>
                  {rows.slice(0, MAX_ROWS).map((row) => (
                    <tr key={`${row.tableKey}.${row.column.name}`}>
                      <td>
                        <a href={href('tables', row.tableKey)} className="explore-table-name">
                          <strong>{row.table.logical_name ?? row.table.name}</strong>
                          <code>{row.tableKey}</code>
                        </a>
                      </td>
                      <td><a href={href('tables', row.tableKey, { tab: 'schema', column: row.column.name })}><code>{row.column.name}</code></a></td>
                      <td>{row.column.logical_name ?? <span className="muted">未設定</span>} <ConfidenceBadge value={row.column.logical_name_status} /></td>
                      <td><code className="type">{row.column.type}</code></td>
                      <td>
                        {row.column.id_system && <a className="badge id" href={href('ids', row.column.id_system)}>{idNames.get(row.column.id_system) ?? row.column.id_system}</a>}
                        <PiiBadge value={row.column.pii} />
                      </td>
                      <td className="explore-desc">{row.column.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > MAX_ROWS && <p className="muted small">先頭 {MAX_ROWS} 件を表示しています。条件を追加して絞り込んでください。</p>}
        </>
      )}
    </div>
  )
}
