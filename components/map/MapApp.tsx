'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import MapControls from './MapControls';
import MapView, { type MapFocus, type MapMove } from './MapView';
import SearchFilters from './SearchFilters';
import TimeSlider from './TimeSlider';
import NavLinks, { tabOf, type AppTab } from '@/components/shell/NavLinks';
import SettingsPanel from '@/components/shell/SettingsPanel';
import RecommendList from '@/components/spot/RecommendList';
import RecommendPage from '@/components/spot/RecommendPage';
import { GradeIcon } from '@/components/spot/RiskBadge';
import SpotSheet from '@/components/spot/SpotSheet';
import { retry, USE_FIXTURES, useApi, useLastReady, useRegionAlerts, type ApiRequest } from '@/lib/hooks/api';
import { DEFAULT_LAYERS, LIVE, PILOT, inPilotBbox, type LayerState } from '@/lib/map/config';
import { liveSummary, loadLiveGrid, WAVE_STOPS, type LiveGrid } from '@/lib/map/live';
import type { Grade, SpotSummary, SpotType } from '@/lib/contract/types';
import { fixtureZonesGeoJson } from '@/lib/ui/dev-fixtures';
import { GRADE_LABEL, TYPE_LABEL } from '@/lib/ui/labels';
import { addHoursIso, floorToHourIso, formatClock, formatPlaceTime, HOURS_AHEAD } from '@/lib/ui/time';

const WAVE_MAX = WAVE_STOPS[WAVE_STOPS.length - 1][0];
const WAVE_GRADIENT = `linear-gradient(to right, ${WAVE_STOPS.map(([h, c]) => `${c} ${(h / WAVE_MAX) * 100}%`).join(', ')})`;
/** 넓게 봐야 보이는 실시간 레이어. 켜면 지도가 물러난다. */
const WIDE_LAYERS = ['waves', 'radar', 'clouds'] as const;

const MAX_INDEX = HOURS_AHEAD - 1;
const NO_SPOTS: SpotSummary[] = [];
const LEGEND: Grade[] = ['safe', 'caution', 'danger'];
// 임시 구역 도형. 개발자 A의 PMTiles 주소가 설정되면 MapView가 이것 대신 타일을 쓴다.
const FIXTURE_ZONES = USE_FIXTURES ? fixtureZonesGeoJson() : null;

type SheetSize = 'collapsed' | 'half' | 'full';
const NEXT_SHEET: Record<SheetSize, SheetSize> = { collapsed: 'half', half: 'full', full: 'collapsed' };
/** 좁은 화면에서 탭을 열었을 때의 시트 높이. 지도 탭은 지도가, 나머지는 내용이 먼저 보여야 한다. */
const TAB_SHEET: Record<AppTab, SheetSize> = { map: 'collapsed', recommend: 'half', settings: 'full' };
const PANEL_LABEL: Record<Exclude<AppTab, 'map'>, string> = { recommend: '추천', settings: '설정과 출처' };

function detectWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/** 주소의 ?spot=<id>&t=<시간>&lng=&lat= 를 읽는다. 추천 화면에서 지도로 넘어올 때 쓴다. */
function readBoot() {
  const q = new URLSearchParams(window.location.search);
  const t = Number(q.get('t'));
  const lng = Number(q.get('lng'));
  const lat = Number(q.get('lat'));
  const hasPoint = q.has('lng') && q.has('lat') && Number.isFinite(lng) && Number.isFinite(lat);
  return {
    webgl: detectWebGL(),
    spot: q.get('spot'),
    index: Number.isInteger(t) && t >= 0 && t <= MAX_INDEX ? t : 0,
    focus: hasPoint ? ({ lng, lat, key: 1 } satisfies MapFocus) : null,
  };
}

/** 지도와 그 위의 패널. 패널의 탭(지도·추천·설정)은 주소로 정해진다. */
export default function MapApp() {
  const router = useRouter();
  const tab = tabOf(usePathname());
  const [boot] = useState(readBoot);
  const [baseTime] = useState(() => floorToHourIso(new Date()));
  const [index, setIndex] = useState(boot.index);
  const [playing, setPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(boot.spot);
  const [panel, setPanel] = useState<'detail' | 'alternatives'>('detail');
  const [sheet, setSheet] = useState<SheetSize>(boot.spot && tab === 'map' ? 'half' : TAB_SHEET[tab]);
  // 탭이 바뀌면 시트 높이를 그 탭에 맞춘다(넓은 화면의 패널은 높이가 고정이라 영향이 없다).
  const [shownTab, setShownTab] = useState(tab);
  if (shownTab !== tab) {
    setShownTab(tab);
    setSheet(tab === 'map' && selectedId ? 'half' : TAB_SHEET[tab]);
  }
  const [query, setQuery] = useState('');
  const [types, setTypes] = useState<SpotType[]>([]);
  const [safeOnly, setSafeOnly] = useState(false);
  const [layers, setLayers] = useState<LayerState>(DEFAULT_LAYERS);
  const [mode, setMode] = useState<'2d' | '3d'>('3d');
  const [focus, setFocus] = useState<MapFocus | null>(boot.focus);
  const [center, setCenter] = useState({ lng: PILOT.center[0], lat: PILOT.center[1], inside: true });
  const [liveGrid, setLiveGrid] = useState<LiveGrid | null>(null);
  const [snack, setSnack] = useState<string | null>(
    boot.webgl ? null : '이 기기에서는 3D 지도를 쓸 수 없어 목록으로 보여 드립니다.',
  );

  const time = addHoursIso(baseTime, index);

  // 슬라이더를 끄는 동안 요청이 몰리지 않게 조금 늦춰서 불러온다.
  const [queryTime, setQueryTime] = useState(time);
  useEffect(() => {
    const id = setTimeout(() => setQueryTime(time), USE_FIXTURES ? 0 : 150);
    return () => clearTimeout(id);
  }, [time]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % (MAX_INDEX + 1)), 900);
    return () => clearInterval(id);
  }, [playing]);

  // 실시간 바람·파고: 해당 레이어가 켜져 있을 때만 받는다.
  const needsLive = boot.webgl && (layers.wind || layers.waves);
  useEffect(() => {
    if (!needsLive) return;
    let alive = true;
    loadLiveGrid().then(
      (grid) => {
        if (alive) setLiveGrid(grid);
      },
      () => {
        if (alive) setSnack('실시간 바람·파고를 불러오지 못했습니다.');
      },
    );
    return () => {
      alive = false;
    };
  }, [needsLive]);

  useEffect(() => {
    if (!snack) return;
    const id = setTimeout(() => setSnack(null), 6000);
    return () => clearTimeout(id);
  }, [snack]);

  const spotsReq: Extract<ApiRequest, { kind: 'spots' }> = { kind: 'spots', time: queryTime };
  const spotsRes = useApi(spotsReq);
  const lastSpots = useLastReady('spots');
  const allSpots = spotsRes.status === 'ready' ? spotsRes.data.spots : (lastSpots?.spots ?? NO_SPOTS);

  const zonesRes = useApi<'zoneGrades'>({ kind: 'zoneGrades', time: queryTime });
  const lastZones = useLastReady('zoneGrades');
  const zoneGrades = zonesRes.status === 'ready' ? zonesRes.data.grades : (lastZones?.grades ?? null);

  // 선택한 시각에 발효 중인 경보. 전 포인트가 '위험'으로 바뀌는 이유라서 지도 위에 항상 보여 준다.
  const alerts = useRegionAlerts(allSpots[0]?.id ?? null, baseTime, HOURS_AHEAD, time);
  const alert = alerts[0] ?? null;

  const visibleSpots = useMemo(
    () => allSpots.filter((s) => (types.length === 0 || types.includes(s.type)) && (!safeOnly || s.grade === 'safe')),
    [allSpots, types, safeOnly],
  );

  const outOfCoverage =
    !center.inside || (spotsRes.status === 'error' && spotsRes.error.code === 'OUT_OF_COVERAGE');
  const loadFailed = spotsRes.status === 'error' && spotsRes.error.code !== 'OUT_OF_COVERAGE';

  const flyTo = (lng: number, lat: number) => setFocus((f) => ({ lng, lat, key: (f?.key ?? 0) + 1 }));

  const selectSpot = (id: string, at?: { lng: number; lat: number }) => {
    setSelectedId(id);
    setPanel('detail');
    setSheet((s) => (s === 'collapsed' ? 'half' : s));
    const point = at ?? allSpots.find((s) => s.id === id);
    if (point) flyTo(point.lng, point.lat);
    // 포인트 상세는 지도 탭에 있다. 다른 탭에서 핀이나 목록을 눌렀으면 그리로 옮긴다.
    if (tab !== 'map') router.push('/');
  };

  const closeSpot = () => {
    setSelectedId(null);
    setPanel('detail');
    setSheet('collapsed');
  };

  const handleMove = (move: MapMove) =>
    setCenter({ lng: Number(move.lng.toFixed(2)), lat: Number(move.lat.toFixed(2)), inside: move.inside });

  const locate = () => {
    if (!('geolocation' in navigator)) {
      setSnack('이 기기에서는 위치를 확인할 수 없습니다.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { longitude, latitude } = pos.coords;
        if (inPilotBbox(longitude, latitude)) flyTo(longitude, latitude);
        else setSnack(`현재 위치는 지원 지역(${PILOT.name}) 밖입니다.`);
      },
      () => setSnack('위치 권한이 없어 현재 위치로 이동하지 못했습니다.'),
    );
  };

  const changeLayers = (next: LayerState) => {
    const turnedOnWide = WIDE_LAYERS.some((k) => next[k] && !layers[k]);
    setLayers(next);
    if (turnedOnWide) {
      setFocus((f) => ({ lng: PILOT.center[0] - 0.35, lat: PILOT.center[1], zoom: LIVE.regionalZoom, key: (f?.key ?? 0) + 1 }));
    }
  };

  const live = liveGrid && needsLive ? liveSummary(liveGrid, PILOT.center[0], PILOT.center[1]) : null;

  const recommendCenter = center.inside ? center : { lng: PILOT.center[0], lat: PILOT.center[1] };

  return (
    <div className="mapapp" data-sheet={sheet}>
      <div className="mapapp__stage">
        {boot.webgl ? (
          <MapView
            spots={visibleSpots}
            selectedId={selectedId}
            onSelect={selectSpot}
            zoneGrades={zoneGrades}
            zonesGeoJson={FIXTURE_ZONES}
            layers={layers}
            mode={mode}
            focus={focus}
            onMove={handleMove}
            liveGrid={liveGrid}
          />
        ) : (
          <ol className="nomap" aria-label="포인트 목록">
            {[...visibleSpots]
              .sort((a, b) => a.score - b.score)
              .map((s) => (
                <li key={s.id}>
                  <button type="button" className="list-item" onClick={() => selectSpot(s.id)}>
                    <GradeIcon grade={s.grade} size={32} />
                    <span className="list-item__text">
                      <span className="list-item__title">{s.name}</span>
                      <span className="list-item__meta">
                        {GRADE_LABEL[s.grade]} · 점수 {s.score} · {TYPE_LABEL[s.type]}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
          </ol>
        )}

        <div className="mapapp__top">
          <SearchFilters
            spots={allSpots}
            query={query}
            onQuery={setQuery}
            types={types}
            onToggleType={(t) => setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))}
            safeOnly={safeOnly}
            onToggleSafe={() => setSafeOnly((v) => !v)}
            onPick={(s) => {
              setQuery('');
              selectSpot(s.id, s);
            }}
          />
          {live && (
            <p className="live-chip" role="status">
              <span className="live-chip__dot" aria-hidden="true" />
              {/* 포인트 상세의 수치(그 포인트의 시간별 예보)와 다른 값이라, 어디의 값인지 적는다. */}
              일대 실시간 {formatClock(live.observedAt)}
              {live.windSpeed !== null && ` · 바람 ${live.windSpeed.toFixed(1)} m/s`}
              {live.waveHeight !== null && ` · 앞바다 파고 ${live.waveHeight.toFixed(1)} m`}
            </p>
          )}
          {alert && (
            <p className="alert-chip" role="status">
              <GradeIcon grade="danger" size={18} />
              <span>
                {alert.headline} · {formatPlaceTime(alert.expires, baseTime)}까지
                {alerts.length > 1 && ` 외 ${alerts.length - 1}건`}
              </span>
            </p>
          )}
          {layers.waves && (
            <p className="wave-legend">
              파고
              <span className="wave-legend__bar" style={{ background: WAVE_GRADIENT }} aria-hidden="true" />
              0 ~ {WAVE_MAX} m
            </p>
          )}
          {outOfCoverage && (
            <p className="banner banner--float" role="status">
              이 지역은 아직 분석되지 않았습니다.
              <button type="button" className="btn btn--text" onClick={() => flyTo(PILOT.center[0], PILOT.center[1])}>
                {PILOT.name} 해안으로 이동
              </button>
            </p>
          )}
          {loadFailed && (
            <p className="banner banner--float banner--danger" role="alert">
              포인트를 불러오지 못했습니다.
              <button type="button" className="btn btn--text" onClick={() => retry(spotsReq)}>
                다시 시도
              </button>
            </p>
          )}
        </div>

        {boot.webgl && <MapControls mode={mode} onMode={setMode} layers={layers} onLayers={changeLayers} onLocate={locate} />}

        <ul className="legend" aria-label="등급 범례">
          {LEGEND.map((g) => (
            <li key={g}>
              <GradeIcon grade={g} size={18} />
              {GRADE_LABEL[g]}
            </li>
          ))}
        </ul>

        <div className="mapapp__time">
          <TimeSlider
            index={index}
            max={MAX_INDEX}
            baseTime={baseTime}
            playing={playing}
            onChange={(i) => {
              setPlaying(false);
              setIndex(i);
            }}
            onTogglePlay={() => setPlaying((v) => !v)}
          />
        </div>
      </div>

      {/* 지도 위에 뜬 패널 하나에 메뉴와 내용이 함께 들어간다. 좁은 화면에서는 아래에서 올라오는 시트가 된다. */}
      <aside className="sheet" aria-label={tab === 'map' ? (selectedId ? '포인트 상세' : '추천 포인트') : PANEL_LABEL[tab]}>
        <button
          type="button"
          className="sheet__handle"
          onClick={() => setSheet((s) => NEXT_SHEET[s])}
          aria-label={sheet === 'full' ? '시트 접기' : '시트 펼치기'}
        >
          <span />
        </button>
        <NavLinks />
        <div className="sheet__content">
          {tab === 'settings' && <SettingsPanel />}
          {tab === 'recommend' && (
            <RecommendPage
              time={queryTime}
              baseTime={baseTime}
              center={recommendCenter}
              alert={alert}
              onPick={(s) => selectSpot(s.id, s)}
            />
          )}
          {tab === 'map' && selectedId && panel === 'detail' && (
            <SpotSheet
              key={selectedId}
              spotId={selectedId}
              baseTime={baseTime}
              index={index}
              hours={HOURS_AHEAD}
              onIndexChange={(i) => {
                setPlaying(false);
                setIndex(i);
              }}
              onClose={closeSpot}
              onRecommend={() => setPanel('alternatives')}
            />
          )}
          {tab === 'map' && selectedId && panel === 'alternatives' && (
            <RecommendList
              title="더 안전한 곳"
              lead="같은 시간대에 지금 포인트보다 위험 점수가 낮은 곳입니다."
              time={queryTime}
              baseTime={baseTime}
              center={recommendCenter}
              alert={alert}
              excludeSpotId={selectedId}
              onPick={(item) => selectSpot(item.id, item)}
              onBack={() => setPanel('detail')}
            />
          )}
          {tab === 'map' && !selectedId && (
            <RecommendList
              title="추천 포인트"
              lead="선택한 시간대에 위험이 낮고 접근이 쉬운 곳입니다."
              time={queryTime}
              baseTime={baseTime}
              center={recommendCenter}
              alert={alert}
              onPick={(item) => selectSpot(item.id, item)}
            />
          )}
        </div>
      </aside>

      {snack && (
        <div className="snackbar" role="status">
          {snack}
        </div>
      )}
    </div>
  );
}
