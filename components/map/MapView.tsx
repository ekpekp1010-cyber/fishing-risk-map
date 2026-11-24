'use client';

import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';
import type { FeatureCollection } from 'geojson';
import { ZONES_LAYER, type Grade, type SpotSummary } from '@/lib/contract/types';
import { GRADE_LABEL, TYPE_LABEL } from '@/lib/ui/labels';
import { GRADE_COLOR, LIVE, MAP_CONFIG, PANEL, PILOT, VIEW_3D, type LayerState } from '@/lib/map/config';
import { startWindParticles, tempImage, tempLabels, waveImage, type LiveGrid, type TempField } from '@/lib/map/live';
import { gradeShapeSvg } from '@/lib/map/pins';
import type { OceanCurrent } from '@/lib/map/currents';
import { createCurrentField, startCurrentParticles } from '@/lib/map/current-flow';

export interface MapFocus {
  lng: number;
  lat: number;
  /** 같은 좌표로 다시 이동할 수 있게 매번 바뀌는 값 */
  key: number;
  /** 주면 그 확대 단계로 물러난다(넓게 봐야 하는 실시간 레이어용). 없으면 가까이 다가간다. */
  zoom?: number;
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
  /** 실시간 바람·파고 격자. 아직 못 받았으면 null */
  liveGrid: LiveGrid | null;
  /** 시간 막대의 시각에 해당하는 기온 격자. 그 시각의 값이 없으면 null이고 기온 그림을 숨긴다 */
  tempField: TempField | null;
  currents?: OceanCurrent[];
}

interface PinEntry {
  marker: maplibregl.Marker;
  el: HTMLButtonElement;
  grade: Grade;
}

const NEUTRAL = '#79747E';
const GRADES: Grade[] = ['safe', 'caution', 'danger'];
let protocolAdded = false;

export default function MapView({
  spots,
  selectedId,
  onSelect,
  zoneGrades,
  layers,
  mode,
  focus,
  onMove,
  liveGrid,
  tempField,
  currents,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const currentField = useRef<ReturnType<typeof createCurrentField>>(null);
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

    // 넓은 화면에서는 왼쪽 패널이 지도 위에 떠 있다. 그만큼을 뺀 나머지의 가운데를 지도 중심으로 삼는다.
    const wide = window.matchMedia(`(min-width: ${PANEL.minWidth}px)`);
    const applyPadding = () => map.setPadding({ top: 0, right: 0, bottom: 0, left: wide.matches ? PANEL.inset : 0 });
    applyPadding();
    wide.addEventListener('change', applyPadding);

    // 출처 표기의 높이를 CSS에 알린다(--attrib-h). 줄 수가 화면 폭과 켠 레이어에 따라 달라지고 접히기도 해서,
    // 좁은 화면의 범례가 고정된 위치에 있으면 글자 위에 얹힌다. 범례는 이 값만큼 위로 비킨다(styles/app.css).
    const attribBox = container.querySelector<HTMLElement>('.maplibregl-ctrl-bottom-left');
    const host = container.closest<HTMLElement>('.mapapp');
    const attribWatch =
      attribBox && host
        ? new ResizeObserver(() => host.style.setProperty('--attrib-h', `${attribBox.offsetHeight}px`))
        : null;
    if (attribBox) attribWatch?.observe(attribBox);

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
      map.addSource('offshore-imagery', {
        type: 'raster',
        tiles: [MAP_CONFIG.offshoreTiles],
        tileSize: 256,
        maxzoom: 9,
        attribution: 'Imagery: Esri, Vantor, Earthstar Geographics, and the GIS User Community',
      });
      map.addLayer(
        { id: 'offshore-imagery', type: 'raster', source: 'offshore-imagery', layout: { visibility: 'none' } },
        firstLabelLayer,
      );
      map.addSource('ocean-base', {
        type: 'raster',
        tiles: [MAP_CONFIG.oceanTiles],
        tileSize: 256,
        maxzoom: 12,
        attribution: MAP_CONFIG.oceanAttribution,
      });
      map.addLayer(
        { id: 'ocean-base', type: 'raster', source: 'ocean-base', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.32 } },
        firstLabelLayer,
      );
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
      // 실시간 레이어: 위성 구름 영상, 강수 레이더, 파고. 처음에는 숨겨 두고 레이어 메뉴로 켠다.
      map.addSource('clouds', {
        type: 'raster',
        tiles: [LIVE.cloudsTiles],
        tileSize: 256,
        maxzoom: LIVE.cloudsMaxZoom,
        attribution: 'NASA GIBS / NOAA GOES-West',
      });
      map.addLayer(
        { id: 'clouds', type: 'raster', source: 'clouds', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.85 } },
        firstLabelLayer,
      );
      // 파고 레이어는 실시간 값을 받은 뒤에 그림으로 추가한다(아래 "실시간 파고" 참고).
      map.addSource('radar', {
        type: 'raster',
        tiles: [LIVE.radarTiles],
        tileSize: 256,
        attribution: 'NEXRAD via Iowa Environmental Mesonet',
      });
      map.addLayer(
        { id: 'radar', type: 'raster', source: 'radar', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.75 } },
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
      const sourceLayer = fromTiles ? { 'source-layer': ZONES_LAYER } : {};
      map.addLayer({
        id: 'zones-fill',
        type: 'fill',
        source: 'zones',
        ...sourceLayer,
        paint: { 'fill-color': NEUTRAL, 'fill-opacity': 0.35, 'fill-antialias': false },
      } as maplibregl.AddLayerObject);
      // 윤곽선을 긋지 않는다. 가장자리를 넓게 흐려 주변과 자연스럽게 이어지게 한다.
      map.addLayer({
        id: 'zones-line',
        type: 'line',
        source: 'zones',
        ...sourceLayer,
        paint: { 'line-color': NEUTRAL, 'line-width': 28, 'line-blur': 28, 'line-opacity': 0.35 },
      } as maplibregl.AddLayerObject);
      // 실제 구역 도형이 없을 때: 포인트를 중심으로 바깥으로 갈수록 옅어지는 색(반지름 약 600 m)
      map.addSource('zone-glow', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'zone-glow',
        type: 'circle',
        source: 'zone-glow',
        paint: {
          'circle-color': ['match', ['get', 'grade'], 'safe', GRADE_COLOR.safe, 'caution', GRADE_COLOR.caution, GRADE_COLOR.danger],
          'circle-blur': 1,
          'circle-opacity': 0.9,
          'circle-pitch-alignment': 'map',
          'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 8, 1.5, 18, 1500],
        },
      });

      // 성능 측정용 표시: 페이지를 연 뒤 지도를 조작할 수 있게 되기까지 걸린 시간
      performance.mark('map-ready');
      setReady(true);
    });

    map.on('moveend', () => {
      const c = map.getCenter();
      // 화면에 시범 지역이 조금이라도 걸쳐 있으면 지원 범위 안으로 본다. 넓게 물러난 화면에서도 안내가 뜨지 않게 한다.
      const b = map.getBounds();
      const [west, south, east, north] = PILOT.bbox;
      const inside = b.getWest() <= east && b.getEast() >= west && b.getSouth() <= north && b.getNorth() >= south;
      onMoveRef.current({ lng: c.lng, lat: c.lat, inside });
    });

    const pins = pinsRef.current;
    return () => {
      wide.removeEventListener('change', applyPadding);
      attribWatch?.disconnect();
      host?.style.removeProperty('--attrib-h');
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
    set('zone-glow', layers.zones);
    set('relief', layers.relief);
    set('flood', layers.flood);
    set('satellite', layers.satellite);
    set('offshore-imagery', layers.satellite);
    set('ocean-base', layers.satellite);
    set('clouds', layers.clouds);
    set('radar', layers.radar);
    set('waves', layers.waves);
    // 기온은 아래의 기온 효과가 맡는다. 그 시각의 값이 없을 때는 켜져 있어도 숨겨야 하기 때문이다.
  }, [ready, layers]);

  // 실시간 파고: 칸의 경계 없이 부드러운 색 그라데이션으로 그린다
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !liveGrid) return;
    const image = waveImage(liveGrid);
    if (!image) return;
    const source = map.getSource('waves') as maplibregl.ImageSource | undefined;
    if (source) {
      source.updateImage(image);
    } else {
      map.addSource('waves', { type: 'image', ...image });
      map.addLayer(
        {
          id: 'waves',
          type: 'raster',
          source: 'waves',
          paint: { 'raster-opacity': 0.6, 'raster-resampling': 'linear', 'raster-fade-duration': 0 },
        },
        map.getStyle().layers.find((l) => l.type === 'symbol')?.id,
      );
    }
    map.setLayoutProperty('waves', 'visibility', layers.waves ? 'visible' : 'none');
  }, [ready, liveGrid, layers.waves]);

  // 기온: 파고와 같은 방식의 색 그라데이션에, 격자 지점마다 숫자를 적는다. 시간 막대를 움직이면 그 시각의 값으로 다시 그린다
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const show = (on: boolean) => {
      for (const id of ['temp', 'temp-labels']) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
      }
    };
    const image = tempField && layers.temp ? tempImage(tempField) : null;
    if (!tempField || !image) {
      show(false);
      return;
    }
    const labels = tempLabels(tempField);
    const source = map.getSource('temp') as maplibregl.ImageSource | undefined;
    if (source) {
      source.updateImage(image);
      (map.getSource('temp-labels') as maplibregl.GeoJSONSource | undefined)?.setData(labels);
    } else {
      const symbols = map.getStyle().layers.filter((l) => l.type === 'symbol');
      map.addSource('temp', { type: 'image', ...image });
      map.addLayer(
        {
          id: 'temp',
          type: 'raster',
          source: 'temp',
          paint: { 'raster-opacity': 0.6, 'raster-resampling': 'linear', 'raster-fade-duration': 0 },
        },
        symbols[0]?.id,
      );
      // 글꼴은 배경 지도가 이미 쓰는 것을 빌린다. 다른 글꼴을 지정하면 글리프를 받지 못해 숫자가 나오지 않는다.
      const font = symbols.map((l) => l.layout?.['text-font']).find((f): f is string[] => Array.isArray(f));
      map.addSource('temp-labels', { type: 'geojson', data: labels });
      map.addLayer({
        id: 'temp-labels',
        type: 'symbol',
        source: 'temp-labels',
        layout: { 'text-field': ['get', 'label'], 'text-size': 14, ...(font ? { 'text-font': font } : {}) },
        paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0, 0, 0, 0.75)', 'text-halo-width': 1.6 },
      });
    }
    show(true);
  }, [ready, tempField, layers.temp]);

  // 실시간 바람: 흐르는 입자. 움직임을 줄이도록 설정한 사용자에게는 그리지 않는다.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !liveGrid || !layers.wind) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    return startWindParticles(map, liveGrid);
  }, [ready, liveGrid, layers.wind]);

  // 시간 변경은 입자의 위치를 유지한 채 다음 프레임부터 새 예보 벡터에 반영한다.
  useEffect(() => {
    currentField.current = createCurrentField(currents ?? []);
  }, [currents]);

  const hasCurrents = Boolean(currents?.length);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !hasCurrents) return;
    return startCurrentParticles(map, () => currentField.current);
  }, [ready, hasCurrents]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !currents) return;
    const markers: maplibregl.Marker[] = [];
    for (const { lng, lat, speed, direction } of currents) {
      const position: [number, number] = [lng, lat];
      // 화살표는 지도와 함께 회전·기울고 숫자는 화면에서 똑바로 읽히게 한다.
      const arrow = document.createElement('span');
      arrow.className = 'current-arrow';
      arrow.textContent = direction === null ? '●' : '↑';
      arrow.setAttribute('aria-hidden', 'true');
      markers.push(new maplibregl.Marker({
        element: arrow, rotation: direction ?? 0, rotationAlignment: 'map', pitchAlignment: 'map',
      }).setLngLat(position).addTo(map));

      const label = document.createElement('span');
      label.className = 'current-speed';
      label.textContent = speed.toFixed(2);
      label.title = `해류 ${label.textContent} m/s${direction === null ? '' : ` · ${direction}° 방향`}`;
      label.setAttribute('aria-label', label.title);
      markers.push(new maplibregl.Marker({ element: label, anchor: 'top', offset: [0, 12] })
        .setLngLat(position).addTo(map));
    }
    return () => markers.forEach(marker => marker.remove());
  }, [ready, currents]);

  // 실제 구역 도형(PMTiles)이 없을 때: 포인트 등급으로 그라데이션 구역을 그린다
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || MAP_CONFIG.zonesPmtilesUrl !== null) return;
    (map.getSource('zone-glow') as maplibregl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: spots.map((s) => ({
        type: 'Feature',
        properties: { grade: s.grade },
        geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      })),
    });
  }, [ready, spots]);

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
    // 출처 표기는 지도를 끌면 (i) 버튼으로 접힌다. 포인트를 골라 이동할 때도 같은 조작으로 보고 접어,
    // 시트가 올라와 좁아진 지도를 가리지 않게 한다. (i)를 누르면 다시 펼쳐진다.
    map.getContainer().querySelector('.maplibregl-ctrl-attrib.maplibregl-compact')?.classList.remove('maplibregl-compact-show');
    if (focus.zoom !== undefined) {
      map.flyTo({ center: [focus.lng, focus.lat], zoom: focus.zoom, pitch: 35, duration: 1400 });
    } else {
      map.flyTo({ center: [focus.lng, focus.lat], zoom: Math.max(map.getZoom(), 15), pitch: VIEW_3D.pitch, duration: 1200 });
    }
  }, [ready, focus]);

  // 지도 라이브러리가 컨테이너의 position을 바꾸므로, 크기는 바깥 요소가 잡는다.
  return (
    <div className="mapview">
      <div ref={containerRef} className="mapview__map" role="application" aria-label="낚시 포인트 위험도 지도" />
    </div>
  );
}
