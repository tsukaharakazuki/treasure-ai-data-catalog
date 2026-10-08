import { useMemo, useRef, useState } from 'react'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import { ArrowDownToLine, Database, GitBranch, Layers3, Network, SquareTerminal, Table2 } from 'lucide-react'
import { toPng } from 'html-to-image'
import { buildLineageView, tableNodeId } from '../core/lineage'
import { tableKey } from '../core/load'
import { href, navigate } from '../router'
import { layoutGraph } from './layout'
import type { CatalogTable, Lineage, LineageNodeType } from '../types/catalog'

export const NODE_TYPE_LABEL: Record<LineageNodeType, string> = {
  source: 'Source',
  table: 'テーブル',
  workflow: 'Workflow',
  saved_query: 'Saved Query',
  parent_segment: 'Parent Segment',
  segment: 'Segment',
  activation: 'Activation',
  external: '外部',
}

const ICONS: Record<LineageNodeType, typeof Database> = {
  source: ArrowDownToLine,
  table: Table2,
  workflow: GitBranch,
  saved_query: SquareTerminal,
  parent_segment: Layers3,
  segment: Layers3,
  activation: Network,
  external: Network,
}

type CardData = {
  label: string
  type: LineageNodeType
  subtitle?: string
  focused: boolean
}
type CardNode = Node<CardData, 'card'>

function LineageCard({ data }: NodeProps<CardNode>) {
  const Icon = ICONS[data.type] ?? Database
  return (
    <div className={`lineage-card type-${data.type}${data.focused ? ' focused' : ''}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="lineage-card-kind"><Icon size={13} /> {NODE_TYPE_LABEL[data.type] ?? data.type}</div>
      <div className="lineage-card-label">{data.label}</div>
      {data.subtitle && <div className="lineage-card-sub">{data.subtitle}</div>}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
}

const nodeTypes = { card: LineageCard }
const CARD_WIDTH = 230
const CARD_HEIGHT = 74

export interface LineageGraphProps {
  lineage: Lineage
  tables: CatalogTable[]
  focus?: string
  depth?: number
  collapseProcesses?: boolean
  hiddenTypes?: LineageNodeType[]
  height?: number | string
  exportName?: string
}

export function LineageGraph({ lineage, tables, focus, depth, collapseProcesses, hiddenTypes, height = '100%', exportName }: LineageGraphProps) {
  const wrapper = useRef<HTMLDivElement>(null)
  const [exporting, setExporting] = useState(false)
  const logicalNames = useMemo(() => new Map(tables.map((table) => [tableKey(table), table.logical_name])), [tables])

  const { nodes, edges } = useMemo(() => {
    const view = buildLineageView(lineage, { focus, depth, collapseProcesses, hiddenTypes })
    const positions = layoutGraph(
      view.nodes.map((node) => ({ id: node.id, width: CARD_WIDTH, height: CARD_HEIGHT })),
      view.edges,
      { ranksep: collapseProcesses ? 110 : 70 },
    )
    const flowNodes: CardNode[] = view.nodes.map((node): CardNode => {
      const isTable = node.type === 'table'
      const key = node.ref ?? node.id.replace(/^table:/, '')
      const logical = isTable ? logicalNames.get(key) : undefined
      return {
        id: node.id,
        type: 'card',
        position: positions.get(node.id) ?? { x: 0, y: 0 },
        data: {
          type: node.type,
          label: isTable ? (logical ?? node.label) : node.label,
          subtitle: isTable ? key : node.description,
          focused: node.id === focus,
        },
      }
    })
    const flowEdges: Edge[] = view.edges.map((edge, index): Edge => {
      const via = edge.via
      const uncertain = edge.confidence === 'inferred' || edge.confidence === 'unresolved'
      return {
        id: `${edge.from}->${edge.to}#${index}`,
        source: edge.from,
        target: edge.to,
        label: via?.length ? via.join(', ') : undefined,
        labelBgPadding: [6, 3],
        labelBgBorderRadius: 6,
        className: uncertain ? 'edge-uncertain' : undefined,
        style: { strokeDasharray: uncertain ? '6 4' : undefined },
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      }
    })
    return { nodes: flowNodes, edges: flowEdges }
  }, [lineage, focus, depth, collapseProcesses, hiddenTypes, logicalNames])

  const exportPng = async () => {
    const target = wrapper.current?.querySelector<HTMLElement>('.react-flow')
    if (!target) return
    setExporting(true)
    try {
      const url = await toPng(target, { backgroundColor: '#f7f7fb', pixelRatio: 2, cacheBust: true })
      const link = document.createElement('a')
      link.href = url
      link.download = `${exportName ?? 'lineage'}.png`
      link.click()
    } finally {
      setExporting(false)
    }
  }

  if (!nodes.length) return <div className="empty">表示できるリネージがありません。</div>

  return (
    <div className="graph-wrapper" ref={wrapper} style={{ height }}>
      <button type="button" className="button ghost small graph-export" onClick={exportPng} disabled={exporting}>
        {exporting ? '出力中…' : 'PNG'}
      </button>
      <ReactFlow
        key={`${focus ?? 'all'}:${depth ?? 'x'}:${collapseProcesses ? 1 : 0}:${(hiddenTypes ?? []).join(',')}`}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15, minZoom: 0.1, maxZoom: 1.2 }}
        minZoom={0.1}
        maxZoom={2}
        nodesDraggable
        nodesConnectable={false}
        onNodeClick={(_, node) => {
          if (node.id.startsWith('table:')) navigate('tables', node.id.slice('table:'.length))
          else navigate('lineage', undefined, { focus: node.id })
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1.1} color="#d6dee8" />
        <MiniMap pannable zoomable nodeStrokeWidth={2} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}

export function lineageHref(key: string): string {
  return href('lineage', undefined, { focus: tableNodeId(key) })
}
