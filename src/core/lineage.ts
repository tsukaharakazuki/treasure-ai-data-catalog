import type { Lineage, LineageEdge, LineageNode, LineageNodeType } from '../types/catalog.ts'

export const TABLE_NODE_PREFIX = 'table:'

export function tableNodeId(key: string): string {
  return `${TABLE_NODE_PREFIX}${key}`
}

export interface LineageView {
  nodes: LineageNode[]
  edges: (LineageEdge & { via?: string[] })[]
}

export interface LineageViewOptions {
  /** Node id to center the view on; everything else is trimmed to its up/downstream. */
  focus?: string
  /** Maximum hops from the focus in each direction. `undefined` = unlimited. */
  depth?: number
  /** Replace process nodes (workflow / saved query) by direct edges labelled with them. */
  collapseProcesses?: boolean
  hiddenTypes?: LineageNodeType[]
}

const PROCESS_TYPES: ReadonlySet<LineageNodeType> = new Set(['workflow', 'saved_query'])

function collapse(lineage: Lineage): LineageView {
  const nodes = new Map(lineage.nodes.map((node) => [node.id, node]))
  const isProcess = (id: string) => PROCESS_TYPES.has(nodes.get(id)?.type as LineageNodeType)
  const incoming = new Map<string, LineageEdge[]>()
  const outgoing = new Map<string, LineageEdge[]>()
  for (const edge of lineage.edges) {
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge])
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge])
  }

  const edges = new Map<string, LineageEdge & { via?: string[] }>()
  const add = (edge: LineageEdge & { via?: string[] }) => {
    const key = `${edge.from}->${edge.to}`
    const existing = edges.get(key)
    if (existing) {
      existing.via = [...new Set([...(existing.via ?? []), ...(edge.via ?? [])])]
    } else {
      edges.set(key, edge)
    }
  }

  for (const edge of lineage.edges) {
    if (isProcess(edge.from) || isProcess(edge.to)) continue
    add({ ...edge })
  }
  for (const node of lineage.nodes) {
    if (!PROCESS_TYPES.has(node.type)) continue
    const inputs = (incoming.get(node.id) ?? []).filter((edge) => !isProcess(edge.from))
    const outputs = (outgoing.get(node.id) ?? []).filter((edge) => !isProcess(edge.to))
    for (const input of inputs) {
      for (const output of outputs) {
        const confidence = input.confidence === 'unresolved' || output.confidence === 'unresolved'
          ? 'unresolved'
          : input.confidence === 'inferred' || output.confidence === 'inferred' ? 'inferred' : output.confidence ?? input.confidence
        add({ from: input.from, to: output.to, type: output.type ?? 'transform', confidence, via: [node.label] })
      }
    }
  }
  return { nodes: lineage.nodes.filter((node) => !PROCESS_TYPES.has(node.type)), edges: [...edges.values()] }
}

function reachable(start: string, edges: LineageEdge[], direction: 'up' | 'down', depth?: number): Map<string, number> {
  const next = new Map<string, string[]>()
  for (const edge of edges) {
    const [from, to] = direction === 'down' ? [edge.from, edge.to] : [edge.to, edge.from]
    next.set(from, [...(next.get(from) ?? []), to])
  }
  const seen = new Map<string, number>([[start, 0]])
  let frontier = [start]
  let hops = 0
  while (frontier.length && (depth === undefined || hops < depth)) {
    hops += 1
    const following: string[] = []
    for (const id of frontier) {
      for (const target of next.get(id) ?? []) {
        if (seen.has(target)) continue
        seen.set(target, hops)
        following.push(target)
      }
    }
    frontier = following
  }
  return seen
}

export function buildLineageView(lineage: Lineage, options: LineageViewOptions = {}): LineageView {
  let view: LineageView = options.collapseProcesses ? collapse(lineage) : { nodes: lineage.nodes, edges: lineage.edges }
  const hidden = new Set(options.hiddenTypes ?? [])
  if (hidden.size) {
    const keep = new Set(view.nodes.filter((node) => !hidden.has(node.type) || node.id === options.focus).map((node) => node.id))
    view = { nodes: view.nodes.filter((node) => keep.has(node.id)), edges: view.edges.filter((edge) => keep.has(edge.from) && keep.has(edge.to)) }
  }
  if (options.focus && view.nodes.some((node) => node.id === options.focus)) {
    const up = reachable(options.focus, view.edges, 'up', options.depth)
    const down = reachable(options.focus, view.edges, 'down', options.depth)
    const keep = new Set([...up.keys(), ...down.keys()])
    // Only keep edges on a path through the focus, not sideways edges between its neighbours.
    view = {
      nodes: view.nodes.filter((node) => keep.has(node.id)),
      edges: view.edges.filter((edge) =>
        (up.has(edge.from) && up.has(edge.to)) || (down.has(edge.from) && down.has(edge.to))),
    }
  }
  return view
}

/** Up- and downstream table node ids of one table node, ignoring process hops. */
export function neighbours(lineage: Lineage, nodeId: string): { upstream: LineageNode[]; downstream: LineageNode[] } {
  const view = collapse(lineage)
  const byId = new Map(view.nodes.map((node) => [node.id, node]))
  const upstream = view.edges.filter((edge) => edge.to === nodeId).map((edge) => byId.get(edge.from)).filter((node): node is LineageNode => Boolean(node))
  const downstream = view.edges.filter((edge) => edge.from === nodeId).map((edge) => byId.get(edge.to)).filter((node): node is LineageNode => Boolean(node))
  return { upstream, downstream }
}

/** Processes (workflows / saved queries) that read or write the given node. */
export function processesTouching(lineage: Lineage, nodeId: string): { readers: LineageNode[]; writers: LineageNode[] } {
  const byId = new Map(lineage.nodes.map((node) => [node.id, node]))
  const isProcess = (node: LineageNode | undefined): node is LineageNode => Boolean(node && PROCESS_TYPES.has(node.type))
  return {
    readers: lineage.edges.filter((edge) => edge.from === nodeId).map((edge) => byId.get(edge.to)).filter(isProcess),
    writers: lineage.edges.filter((edge) => edge.to === nodeId).map((edge) => byId.get(edge.from)).filter(isProcess),
  }
}
