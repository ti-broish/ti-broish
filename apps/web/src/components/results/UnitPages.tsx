import { useState } from 'react'
import {
  aggregateData,
  initialMode,
  mapNodesType,
  mapNodeType,
  riskLevelText,
  showOfficialStreaming,
  unitTitle,
  type ElectionMeta,
  type MapMode,
  type ResultsUnit,
  type SectionsMode,
  type TableMode,
} from '../../home/results'
import { BulgariaMap } from './BulgariaMap'
import { Crumbs } from './Crumbs'
import { SubdivisionTable } from './SubdivisionTable'
import { VideoPanel } from './VideoPanel'
import { ViolationFeed } from './ViolationFeed'

// results: components/units/Aggregation.js — the country (with the map), a МИР, a municipality, a district or a
// country abroad: its subdivisions and, while signals are shown, their feed.
export function Aggregation({ data, segment }: { data: ResultsUnit; segment?: string }) {
  const [mode, setMode] = useState<MapMode>(() => initialMode(data.stats))
  const [sectionsMode, setSectionsMode] = useState<SectionsMode>('risk')
  const subdivisions = (data.nodes ?? []).map((node) => aggregateData(node))
  const tableMode: TableMode = mode === 'video' ? 'violations' : mode

  return (
    <div className="rs-page">
      {data.type !== 'election' ? (
        <>
          <Crumbs crumbs={data.crumbs ?? []} name={data.name} segment={data.segment} />
          <h1>{unitTitle(data)}</h1>
        </>
      ) : (
        <BulgariaMap
          regions={data.nodes ?? []}
          stats={data.stats}
          mode={mode}
          setMode={setMode}
          sectionsMode={sectionsMode}
          setSectionsMode={setSectionsMode}
        />
      )}
      <h1>{mapNodesType(data.nodesType)}</h1>
      <SubdivisionTable subdivisions={subdivisions} mode={tableMode} sectionsMode={sectionsMode} />
      {mode === 'violations' ? (
        <>
          <h1>Сигнали</h1>
          <ViolationFeed segment={segment} totalViolationsCount={data.stats.violationsCount} />
        </>
      ) : null}
    </div>
  )
}

// results: components/units/Section.js
export function Section({ data, meta }: { data: ResultsUnit; meta: ElectionMeta | null }) {
  const stats = data.stats
  const protocols = data.protocols ?? []
  return (
    <div className="rs-page" id="section-data">
      <Crumbs crumbs={data.crumbs ?? []} name={data.name} segment={data.segment} />
      <h1>Секция {data.segment}</h1>
      <h2>Местоположение</h2>
      <table className="rs-details">
        <tbody>
          <tr>
            <td>Код</td>
            <td>{data.segment}</td>
          </tr>
          {(data.crumbs ?? []).map((crumb, i) =>
            i === 0 ? null : (
              <tr key={`${crumb.segment}-${i}`}>
                <td>{mapNodeType(crumb.type)}</td>
                <td>{crumb.name}</td>
              </tr>
            ),
          )}
          <tr>
            <td>Нас. място</td>
            <td>{data.town?.name}</td>
          </tr>
          <tr>
            <td>Адрес</td>
            <td>{data.place}</td>
          </tr>
        </tbody>
      </table>
      <h2>Допълнителни данни</h2>
      <table className="rs-details">
        <tbody>
          <tr>
            <td>Избиратели</td>
            <td>{stats?.voters}</td>
          </tr>
          <tr>
            <td>Действителни гласове</td>
            <td>{stats?.validVotes}</td>
          </tr>
          <tr>
            <td>Недействителни гласове</td>
            <td>{stats?.invalidVotes}</td>
          </tr>
          <tr>
            <td>Сигнали</td>
            <td>{stats?.violationsCount}</td>
          </tr>
          <tr>
            <td>Риск</td>
            <td>{riskLevelText(data.riskLevel)}</td>
          </tr>
        </tbody>
      </table>
      <VideoSlot section={data.segment} town={data.town?.id} meta={meta} />
      {protocols.length > 0 ? <h2>Протоколи:</h2> : null}
      {protocols.map((protocol, index) => (
        <div key={protocol.id ?? index} className="rs-protocol">
          <h3>Протокол {index + 1}</h3>
          <div className="rs-gallery">
            {(protocol.pictures ?? []).map((picture) => (
              <a key={picture.url} href={picture.url} target="_blank" rel="noopener noreferrer">
                <img src={picture.url} alt={`Протокол ${index + 1}`} loading="lazy" />
              </a>
            ))}
          </div>
        </div>
      ))}
      <h2>Сигнали</h2>
      <p>
        {stats?.violationsCount ?? 0} {stats?.violationsCount === 1 ? 'подаден сигнал' : 'подадени сигнала'}
      </p>
      <ViolationFeed segment={data.segment} totalViolationsCount={stats?.violationsCount ?? 0} />
    </div>
  )
}

function VideoSlot({ section, town, meta }: { section: string; town: string | number | undefined; meta: ElectionMeta | null }) {
  if (section.startsWith('32') || !showOfficialStreaming(meta)) return null
  return <VideoPanel section={section} town={town} />
}

