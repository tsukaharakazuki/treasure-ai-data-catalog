import { useState, type ReactNode } from 'react'
import { Code2, Link2 } from 'lucide-react'
import { href } from '../router'
import type { Confidence, LineageConfidence, PiiLevel } from '../types/catalog'

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function CopyButton({ text, label = 'コピー' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle')
  return (
    <button
      type="button"
      className="button ghost small"
      onClick={async () => {
        setState((await copyText(text)) ? 'done' : 'failed')
        window.setTimeout(() => setState('idle'), 1600)
      }}
    >
      {state === 'done' ? 'コピーしました' : state === 'failed' ? 'コピーできません' : label}
    </button>
  )
}

export function SqlBlock({ sql, title, description, engine }: { sql: string; title?: string; description?: string; engine?: string }) {
  return (
    <div className="sql-block">
      <div className="sql-head">
        <div>
          {title && <strong><Code2 size={14} /> {title}</strong>}
          {description && <p className="muted">{description}</p>}
        </div>
        <div className="sql-actions">
          {engine && <span className="badge">{engine}</span>}
          <CopyButton text={sql} />
        </div>
      </div>
      <pre><code>{sql}</code></pre>
    </div>
  )
}

const CONFIDENCE_LABEL: Record<Confidence, string> = { confirmed: '確定', inferred: '推定', needs_review: '要確認' }
export function ConfidenceBadge({ value }: { value?: Confidence }) {
  if (!value || value === 'confirmed') return null
  return <span className={`badge ${value === 'needs_review' ? 'warn' : 'soft'}`}>{CONFIDENCE_LABEL[value]}</span>
}

const LINEAGE_CONFIDENCE_LABEL: Record<LineageConfidence, string> = { exact: '確定', inferred: '推定', unresolved: '未解決' }
export function LineageConfidenceBadge({ value }: { value?: LineageConfidence }) {
  if (!value || value === 'exact') return null
  return <span className={`badge ${value === 'unresolved' ? 'warn' : 'soft'}`}>{LINEAGE_CONFIDENCE_LABEL[value]}</span>
}

const PII_LABEL: Record<PiiLevel, string> = { none: '', identifier: '識別子', personal: '個人情報', sensitive: '要配慮' }
export function PiiBadge({ value }: { value?: PiiLevel }) {
  if (!value || value === 'none') return null
  return <span className={`badge pii-${value}`}>{PII_LABEL[value]}</span>
}

export function TableLink({ tableKey, label }: { tableKey: string; label?: string }) {
  return (
    <a className="table-link" href={href('tables', tableKey)}>
      <code>{tableKey}</code>
      {label && <span>{label}</span>}
    </a>
  )
}

export function ExternalLink({ url, children }: { url?: string; children?: ReactNode }) {
  if (!url || !/^https:\/\//.test(url)) return null
  return (
    <a className="external-link" href={url} target="_blank" rel="noreferrer noopener">
      <Link2 size={13} /> {children ?? 'TD コンソール'}
    </a>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function Section({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel">
      <header className="panel-head">
        <h3>{title}</h3>
        {actions && <div className="panel-actions">{actions}</div>}
      </header>
      {children}
    </section>
  )
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** yyyy-MM-dd HH:mm:ss for a UNIX time (seconds) in the given IANA time zone. */
export function formatUnixTime(seconds: number, timeZone = 'Asia/Tokyo'): string {
  try {
    // Validate the zone; an unknown one in catalog.json falls back to JST.
    new Intl.DateTimeFormat('en-CA', { timeZone })
  } catch {
    timeZone = 'Asia/Tokyo'
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(seconds * 1000))
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`
}

export function formatLastUpdated(table: { last_updated_unixtime?: number; last_updated?: string }, timeZone?: string): string {
  if (typeof table.last_updated_unixtime === 'number' && Number.isFinite(table.last_updated_unixtime)) {
    return formatUnixTime(table.last_updated_unixtime, timeZone)
  }
  if (!table.last_updated) return '-'
  const parsed = Date.parse(table.last_updated)
  // ISO strings from older catalogs are converted; already formatted strings are shown as-is.
  return /T/.test(table.last_updated) && !Number.isNaN(parsed) ? formatUnixTime(parsed / 1000, timeZone) : table.last_updated
}

export function formatNumber(value?: number): string {
  return value === undefined ? '-' : value.toLocaleString('ja-JP')
}
