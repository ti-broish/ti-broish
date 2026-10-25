import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import {
  formatCount,
  formatPercentage,
  mapNodeType,
  rgbGradient,
  sectionSegments,
  sortRows,
  type SectionsMode,
  type TableMode,
  type TableRow,
  type UnitNode,
  type UnitStats,
} from '../../home/results'
import { ExclamationCircle, ExclamationTriangle } from './Icons'
import { Tip, TipCard } from './Tip'

// results: components/subdivision_table — the list of subdivisions under the map or the unit heading.

type Node = UnitNode & { stats: UnitStats }
type DepthMode = 'showAll' | 'showTopNodes' | 'showMiddleNodes' | 'showBottomNodes'
type RowType = 'top' | 'middle' | 'bottom'

const children = (node: Node) => (node.nodes ?? []) as Node[]

function SimpleLine({ row }: { row: TableRow }) {
  return (
    <div>
      <Tip
        className="rs-line"
        style={{ width: `${row.percentage * 100}%` }}
        card={<TipCard title={row.node.name} rows={[{ label: row.tooltipField, value: row.tooltipValue }]} />}
      >
        <span className="rs-line__bar" />
      </Tip>
    </div>
  )
}

function PercentageLine({ stats, sectionsMode }: { stats: UnitStats; sectionsMode: SectionsMode }) {
  return (
    <div className="rs-percentage-line">
      {sectionSegments(stats, sectionsMode).map((segment) => (
        <Tip
          key={segment.displayName}
          className="rs-line rs-line--segment"
          style={{ width: `${segment.percentage * 100}%` }}
          card={
            <TipCard
              title={`${segment.displayName}${segment.percentage ? `  ${formatPercentage(segment.percentage)}%` : ''}`}
              color={segment.color}
              rows={[{ label: 'Брой секции', value: formatCount(segment.count) }]}
            />
          }
        >
          <span className="rs-line__bar" style={{ backgroundColor: segment.color }} />
        </Tip>
      ))}
    </div>
  )
}

function Row({ row, type, mode, sectionsMode }: { row: TableRow; type: RowType; mode: TableMode; sectionsMode: SectionsMode }) {
  const { node } = row
  if (type === 'top' || type === 'middle') {
    return (
      <tr className={`rs-subdivision__row rs-subdivision__row--${type}`}>
        <td colSpan={2} style={{ textAlign: 'left', paddingLeft: type === 'middle' ? '80px' : '20px', paddingRight: 0 }}>
          {type === 'top' ? <b>{node.name}</b> : node.name}
        </td>
      </tr>
    )
  }
  return (
    <tr className="rs-subdivision__row">
      <td>
        {!node.segment ? (
          node.name
        ) : (
          <>
            {node.stats.highRisk > 0 ? (
              <Tip style={{ color: 'rgb(255, 0, 0)' }} card={<TipCard rows={[{ label: 'Високорискови секции', value: formatCount(node.stats.highRisk) }]} />}>
                <ExclamationCircle />{' '}
              </Tip>
            ) : null}
            {node.stats.midRisk > 0 ? (
              <Tip style={{ color: 'rgb(255, 157, 0)' }} card={<TipCard rows={[{ label: 'Среднорискови секции', value: formatCount(node.stats.midRisk) }]} />}>
                <ExclamationCircle />{' '}
              </Tip>
            ) : null}
            {node.stats.violationsCount > 0 ? (
              <Tip
                style={{ color: rgbGradient(255, 255, 0, 255, 0, 0, row.violationPercentage) }}
                card={<TipCard rows={[{ label: 'Сигнали', value: formatCount(node.stats.violationsCount) }]} />}
              >
                <ExclamationTriangle />{' '}
              </Tip>
            ) : null}
            <Link to="/$unit" params={{ unit: node.segment }}>
              {node.number != null ? node.number : null} {node.name}
            </Link>
          </>
        )}
      </td>
      <td>{mode === 'sectionsWithResults' ? <PercentageLine stats={node.stats} sectionsMode={sectionsMode} /> : <SimpleLine row={row} />}</td>
    </tr>
  )
}

export function SubdivisionTable({ subdivisions, mode, sectionsMode }: { subdivisions: Node[]; mode: TableMode; sectionsMode: SectionsMode }) {
  const [depthMode, setDepthMode] = useState<DepthMode>('showAll')
  if (subdivisions.length === 0) return null

  const first = subdivisions[0]
  const maxDepth = !first.nodes ? 1 : !first.nodes[0]?.nodes ? 2 : 3
  const topType = first.type
  const middleType = first.nodes?.[0]?.type
  const bottomType = first.nodes?.[0]?.nodes?.[0]?.type
  const typeAt = (depth: number): RowType => (maxDepth === 3 ? (depth === 3 ? 'top' : depth === 2 ? 'middle' : 'bottom') : maxDepth === 2 && depth === 2 ? 'top' : 'bottom')

  const renderAll = (nodes: Node[], depth: number): React.ReactNode[] =>
    sortRows(nodes, mode, sectionsMode).flatMap((row) => [
      <Row key={`${depth}-${row.node.id}-${row.node.segment}`} row={row} type={typeAt(depth)} mode={mode} sectionsMode={sectionsMode} />,
      ...(depth <= 1 ? [] : renderAll(children(row.node), depth - 1)),
    ])
  const renderFlat = (nodes: Node[]) =>
    sortRows(nodes, mode, sectionsMode).map((row) => (
      <Row key={`${row.node.id}-${row.node.segment}`} row={row} type="bottom" mode={mode} sectionsMode={sectionsMode} />
    ))
  const middle = () => subdivisions.flatMap(children)
  const bottom = () => middle().flatMap(children)

  const button = (value: DepthMode, label: string) => (
    <button type="button" className={depthMode === value ? 'selected' : ''} aria-pressed={depthMode === value} onClick={() => setDepthMode(value)}>
      {label}
    </button>
  )

  return (
    <div className="rs-subdivision">
      <div className="rs-controls rs-controls--table" style={{ marginBottom: '10px' }}>
        {maxDepth > 1 ? (
          <>
            Покажи:
            {button('showAll', 'Всичко')}
            {button('showTopNodes', mapNodeType(topType))}{' '}
          </>
        ) : null}
        {maxDepth >= 2 ? button('showMiddleNodes', mapNodeType(middleType)) : null}
        {maxDepth >= 3 ? button('showBottomNodes', mapNodeType(bottomType)) : null}
      </div>
      <table className="rs-subdivision__table">
        <tbody>
          {depthMode === 'showAll' ? renderAll(subdivisions, maxDepth) : null}
          {depthMode === 'showTopNodes' ? renderFlat(subdivisions) : null}
          {depthMode === 'showMiddleNodes' ? renderFlat(middle()) : null}
          {depthMode === 'showBottomNodes' ? renderFlat(bottom()) : null}
        </tbody>
      </table>
    </div>
  )
}
