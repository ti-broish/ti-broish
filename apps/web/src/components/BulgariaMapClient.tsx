import { useEffect, useState } from 'react'
import { CircleMarker, GeoJSON, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet'
import type { MapArea, MapPoint } from './BulgariaMap'
import type { FeatureCollection, GeoJsonObject, Geometry } from 'geojson'
import { frameAreas } from '../signup/outlines'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const NAMES: Record<string, string> = {
  BLG: 'Благоевград',
  BGS: 'Бургас',
  VAR: 'Варна',
  VTR: 'Велико Търново',
  VID: 'Видин',
  VRC: 'Враца',
  GAB: 'Габрово',
  DOB: 'Добрич',
  KRZ: 'Кърджали',
  KNL: 'Кюстендил',
  LOV: 'Ловеч',
  MON: 'Монтана',
  PAZ: 'Пазарджик',
  PER: 'Перник',
  PVN: 'Плевен',
  PDV: 'Пловдив',
  RAZ: 'Разград',
  RSE: 'Русе',
  SLS: 'Силистра',
  SLV: 'Сливен',
  SML: 'Смолян',
  SOF: 'София-град',
  SFO: 'София',
  SZR: 'Стара Загора',
  TGV: 'Търговище',
  HKV: 'Хасково',
  SHU: 'Шумен',
  JAM: 'Ямбол',
}

const REGION_CODES: Record<string, string[]> = {
  BLG: ['01'],
  BGS: ['02'],
  VAR: ['03'],
  VTR: ['04'],
  VID: ['05'],
  VRC: ['06'],
  GAB: ['07'],
  DOB: ['08'],
  KRZ: ['09'],
  KNL: ['10'],
  LOV: ['11'],
  MON: ['12'],
  PAZ: ['13'],
  PER: ['14'],
  PVN: ['15'],
  PDV: ['16', '17'],
  RAZ: ['18'],
  RSE: ['19'],
  SLS: ['20'],
  SLV: ['21'],
  SML: ['22'],
  SOF: ['23', '24', '25'],
  SFO: ['26'],
  SZR: ['27'],
  TGV: ['28'],
  HKV: ['29'],
  SHU: ['30'],
  JAM: ['31'],
}

type OblastProps = { nuts3?: string }

function selectedFeatures(data: FeatureCollection, regionCodes: string[]) {
  return {
    type: 'FeatureCollection' as const,
    features: data.features.filter((feature) => {
      const nuts = (feature.properties as OblastProps | null)?.nuts3
      const codes = nuts ? REGION_CODES[nuts] ?? [] : []
      return codes.some((code) => regionCodes.includes(code))
    }),
  }
}

function areaKey(area: Geometry | null | undefined) {
  if (!area) return ''
  const raw = JSON.stringify(area)
  return `${area.type}:${raw.length}:${raw.slice(0, 24)}:${raw.slice(-24)}`
}

function FitTo({
  data,
  regionCodes,
  focus,
  areas,
  waitForArea,
  fitSelected = false,
}: {
  data: FeatureCollection
  regionCodes: string[]
  focus?: { lat: number; lng: number; zoom: number } | null
  areas: MapArea[]
  waitForArea?: boolean
  fitSelected?: boolean
}) {
  const map = useMap()
  useEffect(() => {
    const frame = frameAreas(areas, fitSelected)
    if (frame.length > 0) {
      const bounds = L.geoJSON({ type: 'GeometryCollection', geometries: frame.map((item) => item.geometry) } as GeoJsonObject).getBounds()
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15, animate: false })
      return
    }
    if (focus) {
      map.setView([focus.lat, focus.lng], focus.zoom, { animate: false })
      return
    }
    if (waitForArea) return
    const chosen = regionCodes.length > 0 ? selectedFeatures(data, regionCodes) : data
    const features = chosen.features.length > 0 ? chosen : data
    const bounds = L.geoJSON(features as GeoJsonObject).getBounds()
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 8 })
  }, [areas, data, fitSelected, focus, map, regionCodes, waitForArea])
  return null
}

export function BulgariaMapClient({
  regionCodes,
  focus,
  interactive,
  onToggle,
  points = [],
  onPoint,
  area = null,
  areas = [],
  onArea,
  quietCity = false,
  waitForArea = false,
  fitSelected = false,
}: {
  regionCodes: string[]
  focus?: { lat: number; lng: number; zoom: number } | null
  interactive?: boolean
  onToggle?: (regionCode: string) => void
  points?: MapPoint[]
  onPoint?: (id: string) => void
  area?: Geometry | null
  areas?: MapArea[]
  onArea?: (id: string) => void
  quietCity?: boolean
  waitForArea?: boolean
  fitSelected?: boolean
}) {
  const [data, setData] = useState<FeatureCollection | null>(null)
  const shapes = areas.length > 0 ? areas : area ? [{ id: 'area', geometry: area }] : []

  useEffect(() => {
    void fetch('/oblasts.geojson')
      .then((response) => response.json())
      .then((json) => setData(json as FeatureCollection))
      .catch(() => setData(null))
  }, [])

  return (
    <div className="overflow-hidden border border-[#ddd]">
      <MapContainer center={[42.73, 25.4]} zoom={7} scrollWheelZoom={false} style={{ height: 420, width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {data ? (
          <FitTo data={data} regionCodes={regionCodes} focus={focus} areas={shapes} waitForArea={waitForArea} fitSelected={fitSelected} />
        ) : null}
        {data ? (
          <GeoJSON
            key={`${regionCodes.join(',')}:${interactive ? '1' : '0'}:${quietCity ? 'q' : 'f'}`}
            data={data}
            style={(feature) => {
              const nuts = (feature?.properties as OblastProps | undefined)?.nuts3
              const codes = nuts ? REGION_CODES[nuts] ?? [] : []
              const on = codes.some((code) => regionCodes.includes(code))
              return {
                color: '#2b062f',
                weight: on && !quietCity ? 2 : 1,
                fillColor: on && !quietCity ? '#53c0a4' : '#ffffff',
                fillOpacity: on && !quietCity ? 0.35 : 0.05,
              }
            }}
            onEachFeature={(feature, layer) => {
              const nuts = (feature.properties as OblastProps | null)?.nuts3
              const codes = nuts ? REGION_CODES[nuts] ?? [] : []
              layer.bindTooltip(nuts ? NAMES[nuts] ?? nuts : '')
              const toggleCode = codes[0]
              if (interactive && toggleCode) layer.on('click', () => onToggle?.(toggleCode))
            }}
          />
        ) : null}
        {shapes.map((shape) => (
          <GeoJSON
            key={`${shape.id}:${shape.selected === true ? '1' : '0'}:${areaKey(shape.geometry)}`}
            data={shape.geometry}
            style={{
              color: '#2b062f',
              weight: shape.selected === true ? 4 : shape.selected === false ? 2 : 3,
              fillColor: '#53c0a4',
              fillOpacity: shape.selected === true ? 0.62 : shape.selected === false ? 0.14 : 0.45,
            }}
            eventHandlers={{ click: () => onArea?.(shape.id) }}
          />
        ))}
        {points.map((point) => (
          <CircleMarker
            key={point.id}
            center={[point.lat, point.lng]}
            radius={point.selected ? 10 : 8}
            pathOptions={{
              color: point.tone === 'machine' ? '#666' : '#2b062f',
              fillColor: point.tone === 'machine' ? '#bbb' : '#53c0a4',
              fillOpacity: 0.95,
              weight: point.selected ? 3 : 1,
            }}
            eventHandlers={{ click: () => onPoint?.(point.id) }}
          >
            <Popup>
              <strong>{point.label}</strong>
              <br />
              {point.detail}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  )
}
