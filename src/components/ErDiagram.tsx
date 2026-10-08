import { useMemo } from 'react'
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
import { tableKey } from '../core/load'
import { navigate } from '../router'
import { layoutGraph } from './layout'
import type { Cardinality, CatalogTable, Relationship } from '../types/catalog'

type ErColumn = { name: string; logical?: string; type: string; pk: boolean; fk: boolean }
type ErData = { key: string; logical?: string; columns: ErColumn[]; hidden: number; focused: boolean }
type ErNode = Node<ErData, 'er'>

const ROW_HEIGHT = 24
const HEADER_HEIGHT = 52
const WIDTH = 270
const MAX_ROWS = 14

function ErTable({ data }: NodeProps<ErNode>) {
  return (
    <div className={`er-table${data.focused ? ' focused' : ''}`}>
      <div className="er-head">
        <strong>{data.logical ?? data.key}</strong>
        <code>{data.key}</code>
      </div>
      {data.columns.map((column) => (
        <div className="er-row" key={column.name}>
          <Handle id={`${column.name}:in`} type="target" position={Position.Left} isConnectable={false} />
          <span className="er-key">{column.pk ? 'PK' : column.fk ? 'FK' : ''}</span>
          <span className="er-name" title={column.name}>{column.logical ? `${column.logical}` : column.name}</span>
          <span className="er-type">{column.type}</span>
          <Handle id={`${column.name}:out`} type="source" position={Position.Right} isConnectable={false} />
        </div>
      ))}
      {data.hidden > 0 && <div className="er-more">ほか {data.hidden} カラム</div>}
    </div>
  )
}

const nodeTypes = { er: ErTable }

const CARDINALITY_LABEL: Record<Cardinality, string> = {
  'one-to-one': '1 : 1',
  'one-to-many': '1 : N',
  'many-to-one': 'N : 1',
  'many-to-many': 'N : N',
}

export interface ErDiagramProps {
  tables: CatalogTable[]
  relationships: Relationship[]
  focus?: string
  showIsolated?: boolean
  showAllColumns?: boolean
}

export function ErDiagram({ tables, relationships, focus, showIsolated, showAllColumns }: ErDiagramProps) {
  const { nodes, edges } = useMemo(() => {
    const byKey = new Map(tables.map((table) => [tableKey(table), table]))
    const visibleRelations = relationships.filter((relation) =>
      byKey.has(relation.from.table) && byKey.has(relation.to.table)
      && (!focus || relation.from.table === focus || relation.to.table === focus))
    const related = new Set(visibleRelations.flatMap((relation) => [relation.from.table, relation.to.table]))
    if (focus) related.add(focus)
    const keys = showIsolated && !focus ? [...byKey.keys()] : [...related]

    const keyColumns = new Map<string, Set<string>>()
    for (const relation of visibleRelations) {
      for (const end of [relation.from, relation.to]) {
        const set = keyColumns.get(end.table) ?? new Set<string>()
        for (const column of end.columns) set.add(column)
        keyColumns.set(end.table, set)
      }
    }

    const data = new Map<string, ErData>()
    for (const key of keys) {
      const table = byKey.get(key)
      if (!table) continue
      const joined = keyColumns.get(key) ?? new Set<string>()
      const pk = new Set([...(table.primary_key ?? []), ...table.columns.filter((column) => column.is_primary_key).map((column) => column.name)])
      const all = table.columns.map((column) => ({
        name: column.name,
        logical: column.logical_name,
        type: column.type,
        pk: pk.has(column.name),
        fk: joined.has(column.name) && !pk.has(column.name),
      }))
      // Join and key columns must stay visible so every edge has a handle to attach to.
      const important = all.filter((column) => column.pk || joined.has(column.name))
      const rest = all.filter((column) => !column.pk && !joined.has(column.name))
      const shown = showAllColumns ? all : [...important, ...rest.slice(0, Math.max(0, MAX_ROWS - important.length))]
      const order = new Map(all.map((column, index) => [column.name, index]))
      shown.sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0))
      data.set(key, { key, logical: table.logical_name, columns: shown, hidden: all.length - shown.length, focused: key === focus })
    }

    const positions = layoutGraph(
      [...data.values()].map((item) => ({ id: item.key, width: WIDTH, height: HEADER_HEIGHT + ROW_HEIGHT * item.columns.length + (item.hidden ? 24 : 0) })),
      visibleRelations.map((relation) => ({ from: relation.to.table, to: relation.from.table })),
      { rankdir: 'LR', nodesep: 40, ranksep: 120 },
    )
    const flowNodes = [...data.values()].map((item): ErNode => ({
      id: item.key,
      type: 'er',
      position: positions.get(item.key) ?? { x: 0, y: 0 },
      data: item,
    }))
    const flowEdges = visibleRelations.flatMap((relation, index): Edge[] =>
      relation.from.columns.map((column, position): Edge => ({
        id: `rel-${index}-${position}`,
        // Draw from the referenced (parent) table to the referencing one.
        source: relation.to.table,
        sourceHandle: `${relation.to.columns[position] ?? relation.to.columns[0]}:out`,
        target: relation.from.table,
        targetHandle: `${column}:in`,
        label: [relation.cardinality ? CARDINALITY_LABEL[relation.cardinality] : undefined, relation.confidence === 'inferred' ? '推定' : undefined]
          .filter(Boolean).join(' · ') || undefined,
        labelBgPadding: [6, 3],
        labelBgBorderRadius: 6,
        style: { strokeDasharray: relation.confidence === 'confirmed' || !relation.confidence ? undefined : '6 4' },
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      })))
    return { nodes: flowNodes, edges: flowEdges }
  }, [tables, relationships, focus, showIsolated, showAllColumns])

  if (!nodes.length) return <div className="empty">表示できるリレーションがありません。relationships.json を確認してください。</div>

  return (
    <div className="graph-wrapper" style={{ height: '100%' }}>
      <ReactFlow
        key={`${focus ?? 'all'}:${showIsolated ? 1 : 0}:${showAllColumns ? 1 : 0}`}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.12, minZoom: 0.1, maxZoom: 1.1 }}
        minZoom={0.1}
        maxZoom={2}
        nodesConnectable={false}
        onNodeClick={(_, node) => navigate('er', undefined, { focus: node.id })}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1.1} color="#d6dee8" />
        <MiniMap pannable zoomable />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
