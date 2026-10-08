import { useMemo, useState } from 'react'
import { diffCatalogs, type ChangeKind, type FieldChange, type ItemChange } from '../core/diff'
import { Empty, Section, TableLink } from '../components/common'
import type { LoadedCatalog } from '../types/catalog'

const KIND_LABEL: Record<ChangeKind, string> = { added: '追加', removed: '削除', changed: '変更' }

const FIELD_LABEL: Record<string, string> = {
  logical_name: '論理名',
  description: '説明',
  type: '型',
  usage: '利用用途',
  tags: 'タグ',
  owner: 'オーナー',
  update_frequency: '更新頻度',
  primary_key: '主キー',
  sample_queries: 'サンプルクエリ',
  kind: '種別',
  pii: '個人情報区分',
  id_system: 'ID体系',
  values: 'コード値',
  is_primary_key: '主キー',
}

function show(value: unknown): string {
  if (value === undefined || value === null || value === '') return '（なし）'
  if (typeof value === 'string') return value
  const text = JSON.stringify(value)
  return text.length > 160 ? `${text.slice(0, 160)}…` : text
}

function Changes({ changes }: { changes: FieldChange[] }) {
  if (!changes.length) return null
  return (
    <ul className="field-changes">
      {changes.map((change) => (
        <li key={change.field}>
          <span className="field">{FIELD_LABEL[change.field] ?? change.field}</span>
          {change.field === 'sample_queries'
            ? <span className="muted">更新されました</span>
            : <><del>{show(change.before)}</del><span className="arrow">→</span><ins>{show(change.after)}</ins></>}
        </li>
      ))}
    </ul>
  )
}

function ItemList({ title, items }: { title: string; items: ItemChange[] }) {
  if (!items.length) return null
  return (
    <Section title={`${title}（${items.length}）`}>
      <ul className="diff-list">
        {items.map((item) => (
          <li key={`${item.kind}:${item.key}`} className={item.kind}>
            <span className={`diff-kind ${item.kind}`}>{KIND_LABEL[item.kind]}</span>
            <span>{item.label}</span>
            <Changes changes={item.changes.filter((change) => !['key', 'label'].includes(change.field))} />
          </li>
        ))}
      </ul>
    </Section>
  )
}

export function RevisionsView({ catalog }: { catalog: LoadedCatalog }) {
  const available = catalog.revisions.filter((revision) => catalog.snapshots[revision.id])
  const latest = available.at(-1)?.id
  const [to, setTo] = useState(latest ?? '')
  const [from, setFrom] = useState(available.at(-2)?.id ?? '')

  const diff = useMemo(() => {
    const before = catalog.snapshots[from]
    const after = catalog.snapshots[to]
    return before && after ? diffCatalogs(before, after) : undefined
  }, [catalog, from, to])

  const summaryCards: [string, number][] = diff ? [
    ['テーブル追加', diff.summary.tables_added], ['テーブル削除', diff.summary.tables_removed], ['テーブル変更', diff.summary.tables_changed],
    ['カラム追加', diff.summary.columns_added], ['カラム削除', diff.summary.columns_removed], ['カラム変更', diff.summary.columns_changed],
    ['リネージ', diff.summary.lineage_changes], ['ER', diff.summary.relationship_changes], ['用語・事例・ID', diff.summary.glossary_changes], ['アセット', diff.summary.asset_changes],
  ] : []

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h2>リビジョン</h2>
          <p className="muted">カタログは更新のたびにリビジョンが採番されます。2つのリビジョンを選ぶと変更差分を表示します。</p>
        </div>
      </header>

      <Section title="履歴">
        <table className="data-table">
          <thead><tr><th>リビジョン</th><th>作成日時</th><th>作成者</th><th>メモ</th><th>前版からの変更</th><th /></tr></thead>
          <tbody>
            {[...catalog.revisions].reverse().map((revision) => {
              const summary = revision.summary
              const index = available.findIndex((item) => item.id === revision.id)
              return (
                <tr key={revision.id} className={revision.id === catalog.catalog.revision.id ? 'current' : ''}>
                  <td><strong>{revision.id}</strong>{revision.id === catalog.catalog.revision.id && <span className="badge strong">現在</span>}</td>
                  <td>{revision.generated_at?.slice(0, 16).replace('T', ' ')}</td>
                  <td>{revision.generated_by}</td>
                  <td>{revision.note}</td>
                  <td className="muted small">
                    {summary ? `テーブル +${summary.tables_added ?? 0} / -${summary.tables_removed ?? 0} / ~${summary.tables_changed ?? 0}・カラム +${summary.columns_added ?? 0} / -${summary.columns_removed ?? 0} / ~${summary.columns_changed ?? 0}` : '-'}
                  </td>
                  <td>
                    {index > 0 && (
                      <button type="button" className="button ghost small" onClick={() => { setFrom(available[index - 1].id); setTo(revision.id) }}>
                        前版と比較
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Section>

      {available.length < 2 ? (
        <Empty>比較できるリビジョンが2つ以上ありません。更新時に <code>catalog-cli.mjs release</code> を実行すると履歴が残ります。</Empty>
      ) : (
        <>
          <div className="toolbar">
            <label>
              比較元
              <select value={from} onChange={(event) => setFrom(event.target.value)}>
                {available.map((revision) => <option key={revision.id} value={revision.id}>{revision.id} {revision.note ?? ''}</option>)}
              </select>
            </label>
            <span className="arrow">→</span>
            <label>
              比較先
              <select value={to} onChange={(event) => setTo(event.target.value)}>
                {available.map((revision) => <option key={revision.id} value={revision.id}>{revision.id} {revision.note ?? ''}</option>)}
              </select>
            </label>
          </div>

          {diff && (
            <>
              <div className="kpis compact">
                {summaryCards.map(([label, value]) => <div key={label} className={`kpi${value ? ' changed' : ''}`}><span>{label}</span><strong>{value}</strong></div>)}
              </div>
              {diff.tables.length > 0 && (
                <Section title={`テーブル・カラム（${diff.tables.length}）`}>
                  <ul className="diff-list">
                    {diff.tables.map((table) => (
                      <li key={table.key} className={table.kind}>
                        <span className={`diff-kind ${table.kind}`}>{KIND_LABEL[table.kind]}</span>
                        {table.kind === 'removed' ? <code>{table.key}</code> : <TableLink tableKey={table.key} label={table.logicalName} />}
                        <Changes changes={table.changes} />
                        {table.columns.length > 0 && (
                          <ul className="column-changes">
                            {table.columns.map((column) => (
                              <li key={column.name}>
                                <span className={`diff-kind ${column.kind}`}>{KIND_LABEL[column.kind]}</span>
                                <code>{column.name}</code>
                                <Changes changes={column.changes} />
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              <ItemList title="リネージ" items={diff.lineage} />
              <ItemList title="ER（リレーション）" items={diff.relationships} />
              <ItemList title="処理事例" items={diff.recipes} />
              <ItemList title="用語" items={diff.terms} />
              <ItemList title="ID体系" items={diff.idSystems} />
              <ItemList title="アセット" items={diff.assets} />
              {Object.values(diff.summary).every((value) => value === 0) && <Empty>差分はありません。</Empty>}
            </>
          )}
        </>
      )}

      {catalog.changelog && (
        <Section title="CHANGELOG.md">
          <pre className="changelog">{catalog.changelog}</pre>
        </Section>
      )}
    </div>
  )
}
