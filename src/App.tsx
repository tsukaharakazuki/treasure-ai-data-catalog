import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Braces, Database, FolderTree, GitFork, History, Network, Search, Table2, Variable, X } from 'lucide-react'
import { loadCatalogFromFiles } from './core/load'
import { searchCatalog } from './core/search'
import { readCatalogZip } from './core/zip'
import { href, navigate, useRoute, type Section } from './router'
import { Landing } from './views/Landing'
import { Overview } from './views/Overview'
import { TablesView } from './views/TablesView'
import { ErView, LineageView } from './views/GraphViews'
import { AssetsView, GlossaryView, IdSystemsView } from './views/GlossaryViews'
import { RevisionsView } from './views/RevisionsView'
import { ExploreView } from './views/ExploreView'
import type { LoadedCatalog } from './types/catalog'
import './App.css'

const SESSION_KEY = 'treasure-ai-data-catalog:files'
const SESSION_LIMIT = 4_000_000

const NAV: { id: Section; label: string; icon: typeof Database }[] = [
  { id: 'overview', label: '概要', icon: FolderTree },
  { id: 'tables', label: 'テーブル', icon: Table2 },
  { id: 'explore', label: 'テーブル探索', icon: Search },
  { id: 'lineage', label: 'データリネージ', icon: Network },
  { id: 'er', label: 'ER図', icon: GitFork },
  { id: 'glossary', label: '用語・処理事例', icon: BookOpen },
  { id: 'ids', label: 'ID体系', icon: Variable },
  { id: 'assets', label: 'アセット', icon: Braces },
  { id: 'revisions', label: 'リビジョン', icon: History },
]

function restoreSession(): LoadedCatalog | undefined {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return undefined
    return loadCatalogFromFiles(new Map(JSON.parse(raw) as [string, string][]))
  } catch {
    sessionStorage.removeItem(SESSION_KEY)
    return undefined
  }
}

function saveSession(files: Map<string, string>): void {
  try {
    const raw = JSON.stringify([...files.entries()])
    if (raw.length < SESSION_LIMIT) sessionStorage.setItem(SESSION_KEY, raw)
    else sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // Storage is a convenience for reloads only; a full quota is not an error.
  }
}

export default function App() {
  const route = useRoute()
  const [catalog, setCatalog] = useState<LoadedCatalog | undefined>(restoreSession)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  const open = async (load: () => Promise<Map<string, string>>) => {
    setLoading(true)
    setError(undefined)
    try {
      const files = await load()
      const loaded = loadCatalogFromFiles(files)
      setCatalog(loaded)
      saveSession(files)
      navigate('overview')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setLoading(false)
    }
  }

  const openFile = (file: File) => open(() => readCatalogZip(file))
  const openSample = () => open(async () => {
    const response = await fetch('./examples/demo-retail-data-catalog.zip')
    if (!response.ok) throw new Error(`サンプルを取得できません（${response.status}）`)
    return readCatalogZip(await response.blob())
  })
  const close = () => {
    sessionStorage.removeItem(SESSION_KEY)
    setCatalog(undefined)
    window.location.hash = '#/'
  }

  if (!catalog) {
    return (
      <div className="app landing-shell">
        <header className="topbar">
          <a className="brand" href="#/"><img src="./brand/treasure-ai-icon.svg" alt="" /> Treasure AI Data Catalog</a>
        </header>
        <main className="landing-main">
          <Landing onFile={openFile} onSample={openSample} loading={loading} error={error} />
        </main>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href={href('overview')}><img src="./brand/treasure-ai-icon.svg" alt="" /> Treasure AI Data Catalog</a>
        <div className="catalog-title">
          <strong>{catalog.catalog.display_name ?? catalog.catalog.name}</strong>
          <span className="badge strong">{catalog.catalog.revision.id}</span>
        </div>
        <GlobalSearch catalog={catalog} />
        <label className="button ghost small file-button">
          別の ZIP
          <input type="file" accept=".zip,application/zip" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void openFile(file); event.target.value = '' }} />
        </label>
        <button type="button" className="button ghost small" onClick={close} title="カタログを閉じる"><X size={14} /></button>
      </header>
      {error && <div className="banner error">{error}</div>}
      <div className="shell">
        <nav className="sidebar">
          {NAV.map((item) => (
            <a key={item.id} href={href(item.id)} className={route.section === item.id ? 'active' : ''}>
              <item.icon size={16} /> {item.label}
            </a>
          ))}
          <div className="sidebar-foot muted small">
            <div>{catalog.catalog.customer}</div>
            <div>site: {catalog.catalog.td?.site ?? '-'}</div>
            <div>言語: {catalog.catalog.language}</div>
          </div>
        </nav>
        <main className="content">
          {route.section === 'overview' && <Overview catalog={catalog} />}
          {route.section === 'tables' && <TablesView catalog={catalog} route={route} />}
          {route.section === 'explore' && <ExploreView key={route.params.get('q') ?? ''} catalog={catalog} route={route} />}
          {route.section === 'lineage' && <LineageView catalog={catalog} route={route} />}
          {route.section === 'er' && <ErView catalog={catalog} route={route} />}
          {route.section === 'glossary' && <GlossaryView key={route.id ?? route.params.get('term') ?? ''} catalog={catalog} route={route} />}
          {route.section === 'ids' && <IdSystemsView catalog={catalog} route={route} />}
          {route.section === 'assets' && <AssetsView catalog={catalog} route={route} />}
          {route.section === 'revisions' && <RevisionsView catalog={catalog} />}
        </main>
      </div>
    </div>
  )
}

function GlobalSearch({ catalog }: { catalog: LoadedCatalog }) {
  const [query, setQuery] = useState('')
  const [openList, setOpenList] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const hits = useMemo(() => searchCatalog(catalog, query, 12), [catalog, query])

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as globalThis.Node)) setOpenList(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const target = (hit: (typeof hits)[number]) => {
    if (hit.kind === 'table') return href('tables', hit.key)
    if (hit.kind === 'column') return href('tables', hit.key, { tab: 'schema', column: hit.column })
    if (hit.kind === 'recipe') return href('glossary', hit.key)
    return href('glossary', undefined, { term: hit.key })
  }
  const KIND: Record<string, string> = { table: 'テーブル', column: 'カラム', term: '用語', recipe: '処理事例' }

  return (
    <div className="global-search" ref={box}>
      <label className="search-input">
        <Search size={14} />
        <input
          value={query}
          onChange={(event) => { setQuery(event.target.value); setOpenList(true) }}
          onFocus={() => setOpenList(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && hits[0]) { window.location.hash = target(hits[0]); setOpenList(false) }
            if (event.key === 'Escape') setOpenList(false)
          }}
          placeholder="テーブル・カラム・用語を検索（例: 会員ID、売上）"
        />
      </label>
      {openList && query && (
        <ul className="search-results">
          <li className="search-explore">
            <a href={href('explore', undefined, { q: query })} onClick={() => setOpenList(false)}>
              <Search size={13} /> 「{query}」を全テーブルのカラムから探す（テーブル探索）
            </a>
          </li>
          {hits.length === 0 && <li className="muted pad">見つかりません</li>}
          {hits.map((hit) => (
            <li key={`${hit.kind}:${hit.key}:${hit.column ?? ''}`}>
              <a href={target(hit)} onClick={() => setOpenList(false)}>
                <span className={`hit-kind ${hit.kind}`}>{KIND[hit.kind]}</span>
                <span className="hit-title">{hit.title}</span>
                {hit.subtitle && <span className="hit-sub">{hit.subtitle}</span>}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
