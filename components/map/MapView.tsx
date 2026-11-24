'use client';

import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';
import type { FeatureCollection } from 'geojson';
import type { Grade, SpotSummary } from '@/lib/ui/api-types';
import { GRADE_LABEL, TYPE_LABEL } from '@/lib/ui/labels';
import { GRADE_COLOR, MAP_CONFIG, PILOT, VIEW_3D, inPilotBbox, type LayerState } from '@/lib/map/config';
import { gradeShapeSvg } from '@/lib/map/pins';

export interface MapFocus {
  lng: number;
  lat: number;
  /** 같은 좌표로 다시 이동할 수 있게 매번 바뀌는 값 */
  key: number;
}

export interface MapMove {
  lng: number;
  lat: number;
  inside: boolean;
}

interface Props {
  spots: SpotSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  zoneGrades: Record<string, Grade> | null;
  zonesGeoJson: FeatureCollection | null;
  layers: LayerState;
  mode: '2d' | '3d';
  focus: MapFocus | null;
  onMove: (move: MapMove) => void;
}

interface PinEntry {
  marker: maplibregl.Marker;
  el: HTMLButtonElement;
  grade: Grade;
}

const NEUTRAL = '#79747E';
const GRADES: Grade[] = ['safe', 'caution', 'danger'];
let protocolAdded = false;

export default function MapView({ spots, selectedId, onSelect, zoneGrades, zonesGeoJson, layers, mode, focus, onMove }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const pinsRef = useRef(new Map<string, PinEntry>());
  const onSelectRef = useRef(onSelect);
  const onMoveRef = useRef(onMove);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    onSelectRef.current = onSelect;
    onMoveRef.current = onMove;
  });

  // 지도 만들기 (한 번)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!protocolAdded) {
      // 번들러가 작업자 파일을 찾지 못하므로 public/에 복사해 둔 파일을 직접 가리킨다(package.json의 postinstall).
      maplibregl.setWorkerUrl('/maplibre-gl-worker.mjs');
      maplibregl.addProtocol('pmtiles', new Protocol().tile);
      protocolAdded = true;
    }
    const map = new maplibregl.Map({
      container,
      style: MAP_CONFIG.styleUrl,
      center: PILOT.center,
      zoom: PILOT.zoom,
      pitch: VIEW_3D.pitch,
      bearing: VIEW_3D.bearing,
      maxPitch: 80,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution:
          '<a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather data by Open-Meteo.com</a>',
      }),
      'bottom-left',
    );

    map.on('load', () => {
      const dem = {
        type: 'raster-dem' as const,
        tiles: [MAP_CONFIG.terrainTiles],
        tileSize: 256,
        encoding: MAP_CONFIG.terrainEncoding,
        maxzoom: MAP_CONFIG.terrainMaxZoom,
      };
      map.addSource('dem', dem);
      map.addSource('dem-relief', dem);

      // 항공·위성 사진을 지형 위에 입힌다. 지명 글자는 사진 위에 남도록 첫 글자 레이어 바로 아래에 넣는다.
      const firstLabelLayer = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
      map.addSource('satellite', {
        type: 'raster',
        tiles: [MAP_CONFIG.satelliteTiles],
        tileSize: 256,
        maxzoom: MAP_CONFIG.satelliteMaxZoom,
        attribution: MAP_CONFIG.satelliteAttribution,
      });
      map.addLayer(
        { id: 'satellite', type: 'raster', source: 'satellite', layout: { visibility: 'none' } },
        firstLabelLayer,
      );
      // 하늘과 먼 곳의 안개. 기울여 볼 때 지평선이 자연스럽게 보인다.
      map.setSky({
        'sky-color': '#7fb2e5',
        'horizon-color': '#dce9f5',
        'fog-color': '#dce9f5',
        'sky-horizon-blend': 0.6,
        'horizon-fog-blend': 0.6,
        'fog-ground-blend': 0.35,
        'atmosphere-blend': 0.6,
      });
      map.addLayer({
        id: 'relief',
        type: 'hillshade',
        source: 'dem-relief',
        layout: { visibility: 'none' },
        paint: { 'hillshade-exaggeration': 0.6 },
      });
      if (MAP_CONFIG.floodTiles) {
        map.addSource('flood', { type: 'raster', tiles: [MAP_CONFIG.floodTiles], tileSize: 256 });
        map.addLayer({
          id: 'flood',
          type: 'raster',
          source: 'flood',
          layout: { visibility: 'none' },
          paint: { 'raster-opacity': 0.6 },
        });
      }

      const fromTiles = MAP_CONFIG.zonesPmtilesUrl !== null;
      if (fromTiles) {
        map.addSource('zones', { type: 'vector', url: `pmtiles://${MAP_CONFIG.zonesPmtilesUrl}` });
      } else {
        map.addSource('zones', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      }
      const sourceLayer = fromTiles ? { 'source-layer': 'zones' } : {};
      map.addLayer({
        id: 'zones-fill',
        type: 'fill',
        source: 'zones',
        ...sourceLayer,
        paint: { 'fill-color': NEUTRAL, 'fill-opacity': 0.45 },
      } as maplibregl.AddLayerObject);
      map.addLayer({
        id: 'zones-line',
        type: 'line',
        source: 'zones',
        ...sourceLayer,
        paint: { 'line-color': NEUTRAL, 'line-width': 2.5 },
      } as maplibregl.AddLayerObject);

      // 성능 측정용 표시: 페이지를 연 뒤 지도를 조작할 수 있게 되기까지 걸린 시간
      performance.mark('map-ready');
      setReady(true);
    });

    map.on('moveend', () => {
      const c = map.getCenter();
      onMoveRef.current({ lng: c.lng, lat: c.lat, inside: inPilotBbox(c.lng, c.lat) });
    });

    const pins = pinsRef.current;
    return () => {
      pins.forEach((p) => p.marker.remove());
      pins.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 2D / 3D 전환
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setTerrain(mode === '3d' ? { source: 'dem', exaggeration: VIEW_3D.exaggeration } : null);
    map.easeTo({ pitch: mode === '3d' ? VIEW_3D.pitch : 0, bearing: mode === '3d' ? VIEW_3D.bearing : 0, duration: 600 });
  }, [ready, mode]);

  // 레이어 켜고 끄기
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const set = (id: string, on: boolean) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    };
    set('zones-fill', layers.zones);
    set('zones-line', layers.zones);
    set('relief', layers.relief);
    set('flood', layers.flood);
    set('satellite', layers.satellite);
  }, [ready, layers]);

  // 임시 구역 도형 (PMTiles가 없을 때)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || MAP_CONFIG.zonesPmtilesUrl !== null || !zonesGeoJson) return;
    (map.getSource('zones') as maplibregl.GeoJSONSource | undefined)?.setData(zonesGeoJson);
  }, [ready, zonesGeoJson]);

  // 시각에 따라 구역 색 바꾸기
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const entries = Object.entries(zoneGrades ?? {});
    const color: string | maplibregl.ExpressionSpecification =
      entries.length === 0
        ? NEUTRAL
        : ([
            'match',
            ['get', 'zoneId'],
            ...entries.flatMap(([id, g]) => [id, GRADE_COLOR[g]]),
            NEUTRAL,
          ] as unknown as maplibregl.ExpressionSpecification);
    map.setPaintProperty('zones-fill', 'fill-color', color);
    map.setPaintProperty('zones-line', 'line-color', color);
  }, [ready, zoneGrades]);

  // 포인트 핀: 키보드로 이동할 수 있도록 실제 버튼으로 만든다
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const pins = pinsRef.current;
    const seen = new Set<string>();
    for (const s of spots) {
      seen.add(s.id);
      let pin = pins.get(s.id);
      if (!pin) {
        const el = document.createElement('button');
        el.type = 'button';
        el.classList.add('pin');
        el.innerHTML = gradeShapeSvg(s.grade, 36);
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          onSelectRef.current(s.id);
        });
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([s.lng, s.lat]).addTo(map);
        pin = { marker, el, grade: s.grade };
        pins.set(s.id, pin);
      } else if (pin.grade !== s.grade) {
        pin.el.innerHTML = gradeShapeSvg(s.grade, 36);
        pin.grade = s.grade;
      }
      for (const g of GRADES) pin.el.classList.toggle(`pin--${g}`, g === s.grade);
      pin.el.classList.toggle('pin--selected', s.id === selectedId);
      pin.el.setAttribute('aria-pressed', String(s.id === selectedId));
      pin.el.setAttribute('aria-label', `${s.name}, ${TYPE_LABEL[s.type]}, ${GRADE_LABEL[s.grade]}, 위험 점수 ${s.score}`);
    }
    for (const [id, pin] of pins) {
      if (!seen.has(id)) {
        pin.marker.remove();
        pins.delete(id);
      }
    }
  }, [ready, spots, selectedId]);

  // 선택한 포인트나 검색 결과로 이동
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focus) return;
    map.flyTo({ center: [focus.lng, focus.lat], zoom: Math.max(map.getZoom(), 15), duration: 1200 });
  }, [ready, focus]);

  // 지도 라이브러리가 컨테이너의 position을 바꾸므로, 크기는 바깥 요소가 잡는다.
  return (
    <div className="mapview">
      <div ref={containerRef} className="mapview__map" role="application" aria-label="낚시 포인트 위험도 지도" />
    </div>
  );
}
