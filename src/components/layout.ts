import dagre from '@dagrejs/dagre'

export interface LayoutInput {
  id: string
  width: number
  height: number
}

export interface LayoutOptions {
  rankdir?: 'LR' | 'TB'
  nodesep?: number
  ranksep?: number
}

/** Positions (top-left corners) for each node, laid out as a layered DAG. */
export function layoutGraph(
  nodes: LayoutInput[],
  edges: { from: string; to: string }[],
  options: LayoutOptions = {},
): Map<string, { x: number; y: number }> {
  const graph = new dagre.graphlib.Graph()
  graph.setGraph({ rankdir: options.rankdir ?? 'LR', nodesep: options.nodesep ?? 28, ranksep: options.ranksep ?? 90, marginx: 24, marginy: 24 })
  graph.setDefaultEdgeLabel(() => ({}))
  for (const node of nodes) graph.setNode(node.id, { width: node.width, height: node.height })
  for (const edge of edges) {
    if (edge.from !== edge.to && graph.hasNode(edge.from) && graph.hasNode(edge.to)) graph.setEdge(edge.from, edge.to)
  }
  dagre.layout(graph)
  const positions = new Map<string, { x: number; y: number }>()
  for (const node of nodes) {
    const placed = graph.node(node.id)
    positions.set(node.id, { x: (placed?.x ?? 0) - node.width / 2, y: (placed?.y ?? 0) - node.height / 2 })
  }
  return positions
}
