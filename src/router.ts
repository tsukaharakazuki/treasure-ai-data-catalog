import { useEffect, useState } from 'react'

export type Section = 'overview' | 'tables' | 'lineage' | 'er' | 'glossary' | 'ids' | 'assets' | 'revisions'

export interface Route {
  section: Section
  /** Second path segment, e.g. the table key in `#/tables/<key>`. */
  id?: string
  params: URLSearchParams
}

const SECTIONS: readonly Section[] = ['overview', 'tables', 'lineage', 'er', 'glossary', 'ids', 'assets', 'revisions']

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '')
  const [path, query = ''] = raw.split('?')
  const [first, ...rest] = path.split('/').filter(Boolean)
  const section = SECTIONS.includes(first as Section) ? (first as Section) : 'overview'
  return { section, id: rest.length ? decodeURIComponent(rest.join('/')) : undefined, params: new URLSearchParams(query) }
}

export function href(section: Section, id?: string, params?: Record<string, string | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params ?? {})) if (value) query.set(key, value)
  const search = query.toString()
  return `#/${section}${id ? `/${encodeURIComponent(id)}` : ''}${search ? `?${search}` : ''}`
}

export function navigate(section: Section, id?: string, params?: Record<string, string | undefined>): void {
  window.location.hash = href(section, id, params)
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
