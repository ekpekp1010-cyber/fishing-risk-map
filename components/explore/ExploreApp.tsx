'use client';

// 메인 화면. 지도 앱처럼 실사 3D 지도가 화면을 채우고, 그 위에 꼭 필요한 것만 띄운다.
//   위: 검색창 + 안전한 곳 버튼, 장소 종류 칩, 특보 알림
//   왼쪽: 지금 바다 상태(파도·바람)
//   오른쪽: 2D·3D 전환, 내 위치
//   아래: 시간 고르기와 내용 시트(요약·포인트 카드·추천·정보), 아래 메뉴(지도·추천·정보)
// 넓은 화면에서는 시트가 왼쪽 카드가 된다.

import '@/styles/explore.css';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MapViewState } from '@deck.gl/core';
import { ExIcon, type ExIconName } from './icons';
import LayerMenu from './LayerMenu';
import SafeList from './SafeList';
import SavedList from './SavedList';
import SpotCard from './SpotCard';
import MapView, { type MapFocus } from '@/components/map/MapView';
import PhotorealView, { type PhotorealStats } from '@/components/map/PhotorealView';
import SettingsPanel from '@/components/shell/SettingsPanel';
import { GradeIcon } from '@/components/spot/RiskBadge';
import { USE_FIXTURES, useApi, useLastReady, useRegionAlerts } from '@/lib/hooks/api';
import { DEFAULT_LAYERS, PILOT, type LayerState } from '@/lib/map/config';
import { loadCurrentForecast, type CurrentForecast } from '@/lib/map/currents';
import { liveSummary, loadLiveGrid, TEMP_STOPS, WAVE_STOPS, type LiveGrid } from '@/lib/map/live';
import { loadTempForecast, type TempForecast } from '@/lib/map/temperature';
import { sunPosition } from '@/lib/map/sun';
import type { Grade, RecommendationItem, SpotSummary, SpotType } from '@/lib/contract/types';
import { fixtureZonesGeoJson } from '@/lib/ui/dev-fixtures';
import { GRADE_SHORT, plainTime, TYPE_PLAIN, waveLevel, windLevel, type PlainLevel } from '@/lib/ui/plain';
import { addHoursIso, floorToHourIso, formatPlaceTime, HOURS_AHEAD, placeHour } from '@/lib/ui/time';

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
const MAX_INDEX = HOURS_AHEAD - 1;
const NO_SPOTS: SpotSummary[] = [];
// 임시 구역 도형. 실제 구역 도형(개발자 A의 PMTiles)은 실사 지도에 아직 연결하지 않았다.
const ZONES = fixtureZonesGeoJson();
const NO_ZONES: typeof ZONES = { type: 'FeatureCollection', features: [] };

/** 처음에는 일반 도로 지도와 위험 구역만 보여 준다. 나머지는 레이어 버튼으로 켠다. */
const START_LAYERS: LayerState = { ...DEFAULT_LAYERS, satellite: false, wind: false };

const gradient = (stops: ReadonlyArray<readonly [number, string]>) => {
  const min = stops[0][0];
  const span = stops[stops.length - 1][0] - min;
  return `linear-gradient(to right, ${stops.map(([v, c]) => `${c} ${((v - min) / span) * 100}%`).join(', ')})`;
};
const WAVE_GRADIENT = gradient(WAVE_STOPS);
const TEMP_GRADIENT = gradient(TEMP_STOPS);

type MapMode = '2d' | '3d';

/** 체험용 '내 위치'. 뉴포트 베이프런트(항구 거리)에 있다고 가정한다. */
const DEMO_LOCATION = { lng: -124.0556, lat: 44.6266, name: '뉴포트 항구 거리' };

const OVERVIEW: MapViewState = {
  longitude: PILOT.center[0],
  latitude: PILOT.center[1] - 0.012,
  zoom: 14.2,
  pitch: 60,
  bearing: -24,
};

const TYPE_ICON: Record<SpotType, ExIconName> = {
  jetty: 'jetty',
  pier: 'pier',
  rocks: 'rocks',
  beach: 'beach',
  estuary: 'estuary',
};
const TYPES: SpotType[] = ['jetty', 'pier', 'rocks', 'beach', 'estuary'];

/** 아래 메뉴. 주소가 곧 탭이라 새로고침과 뒤로 가기가 그대로 동작한다. */
type Tab = 'map' | 'recommend' | 'saved' | 'settings';
const NAV: Array<{ tab: Tab; href: string; label: string; icon: ExIconName }> = [
  { tab: 'map', href: '/', label: '지도', icon: 'map' },
  { tab: 'recommend', href: '/recommend', label: '안전', icon: 'shield' },
  { tab: 'saved', href: '/saved', label: '저장', icon: 'star' },
];
/** 메뉴에는 없지만 주소로 열 수 있는 탭(데이터 출처 등) */
const TAB_BY_PATH: Record<string, Tab> = { '/': 'map', '/recommend': 'recommend', '/saved': 'saved', '/settings': 'settings' };

type Sheet = 'peek' | 'half' | 'full';
const NEXT_SHEET: Record<Sheet, Sheet> = { peek: 'half', half: 'full', full: 'peek' };
const TAB_SHEET: Record<Tab, Sheet> = { map: 'peek', recommend: 'half', saved: 'half', settings: 'full' };

function wantsPhotoreal(): boolean {
  if (!API_KEY) return false;
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  return !saveData;
}

/** 자주 고르는 시간: 지금, 3시간 뒤, 오늘 저녁(18시), 내일 새벽(5시), 내일 저녁 */
function quickTimes(baseTime: string): Array<{ label: string; index: number }> {
  const out = [
    { label: '지금', index: 0 },
    { label: '3시간 뒤', index: 3 },
  ];
  const find = (hour: number, day: '오늘' | '내일') => {
    for (let i = 1; i <= MAX_INDEX; i++) {
      const t = addHoursIso(baseTime, i);
      if (placeHour(t) === hour && formatPlaceTime(t, baseTime).startsWith(day)) return i;
    }
    return -1;
  };
  const evening = find(18, '오늘');
  if (evening > 3) out.push({ label: '오늘 저녁', index: evening });
  const dawn = find(5, '내일');
  if (dawn > 0) out.push({ label: '내일 새벽', index: dawn });
  const tomorrowEvening = find(18, '내일');
  if (tomorrowEvening > 0) out.push({ label: '내일 저녁', index: tomorrowEvening });
  return out;
}

/** 지금 바다 상태 한 줄: 아이콘, 이름, 세 칸 막대, 한마디. 칸 수와 색이 같이 바뀌어 색을 못 봐도 구분된다. */
function WeatherItem({ icon, name, value }: { icon: ExIconName; name: string; value: PlainLevel }) {
  return (
    <span className={`ex-weather__item ex-weather__item--${value.level}`} role="img" aria-label={`${name} ${value.text}`}>
      <ExIcon name={icon} size={20} />
      <span className="ex-weather__name">{name}</span>
      <span className="ex-meter" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <i key={n} data-on={n <= value.level ? 'yes' : 'no'} />
        ))}
      </span>
      <b>{value.text}</b>
    </span>
  );
}

export default function ExploreApp() {
  const router = useRouter();
  const tab: Tab = TAB_BY_PATH[usePathname()] ?? 'map';
  const [photoreal] = useState(wantsPhotoreal);
  const [baseTime] = useState(() => floorToHourIso(new Date()));
  const [index, setIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(TAB_SHEET[tab]);
  const [shownTab, setShownTab] = useState(tab);
  if (shownTab !== tab) {
    setShownTab(tab);
    setSheet(TAB_SHEET[tab]);
  }
  const [query, setQuery] = useState('');
  const [types, setTypes] = useState<SpotType[]>([]);
  const [safeOnly, setSafeOnly] = useState(false);
  // 기본은 2D 지도. 3D 버튼을 누르면 실사 3D로 바꾼다(그때만 Google 타일을 받는다).
  const [mapMode, setMapMode] = useState<MapMode>('2d');
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [view, setView] = useState<MapViewState>(OVERVIEW);
  // 2D·3D를 바꿔도 같은 곳을 보도록 마지막 카메라 위치를 기억한다(화면을 다시 그리지 않게 ref로).
  const cam = useRef({ lng: PILOT.center[0], lat: PILOT.center[1], zoom: PILOT.zoom });
  const [credits, setCredits] = useState('');
  const [mapStats, setMapStats] = useState<PhotorealStats | null>(null);
  // 접힌 시트는 내용 높이에 맞춘다. 그 높이를 재서 시트 위에 놓이는 버튼·출처·범례 위치(--sheet-h)에 쓴다.
  const rootRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    const el = sheetRef.current;
    if (!root || !el) return;
    if (sheet !== 'peek') {
      root.style.removeProperty('--sheet-h');
      return;
    }
    const apply = () => root.style.setProperty('--sheet-h', `${el.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sheet]);

  const [liveGrid, setLiveGrid] = useState<LiveGrid | null>(null);
  const live = useMemo(() => (liveGrid ? liveSummary(liveGrid, PILOT.center[0], PILOT.center[1]) : null), [liveGrid]);
  const [layers, setLayers] = useState<LayerState>(START_LAYERS);
  const [currentForecast, setCurrentForecast] = useState<CurrentForecast | null>(null);
  const [currentFailed, setCurrentFailed] = useState(false);

  const time = addHoursIso(baseTime, index);

  // 시간 막대의 시각에 맞춰 지도에 밤낮을 표시한다. '지금'은 실제 현재 시각(그 시간 안)으로 본다.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const baseMs = Date.parse(baseTime);
  const sunMs = index === 0 ? Math.min(Math.max(nowMs, baseMs), baseMs + 59 * 60_000) : Date.parse(time);
  const sunAltitude = layers.daylight ? sunPosition(sunMs, PILOT.center[0], PILOT.center[1]).altitude : null;
  const quick = useMemo(() => quickTimes(baseTime), [baseTime]);
  const currents = layers.currents ? currentForecast?.get(Date.parse(time) / 1000) : undefined;

  // 바닷물 흐름(해류) 예보는 그 레이어를 켰을 때만 받는다.
  useEffect(() => {
    if (!layers.currents || currentForecast || currentFailed) return;
    const controller = new AbortController();
    loadCurrentForecast(baseTime, controller.signal).then(
      (forecast) => {
        if (!controller.signal.aborted) setCurrentForecast(forecast);
      },
      () => {
        if (!controller.signal.aborted) setCurrentFailed(true);
      },
    );
    return () => controller.abort();
  }, [baseTime, layers.currents, currentForecast, currentFailed]);

  // 기온 예보도 그 레이어를 켰을 때만 받는다. 시간 막대를 옮기면 그 시각의 기온을 그린다.
  const [tempForecast, setTempForecast] = useState<TempForecast | null>(null);
  const [tempFailed, setTempFailed] = useState(false);
  useEffect(() => {
    if (!layers.temp || tempForecast || tempFailed) return;
    const controller = new AbortController();
    loadTempForecast(baseTime, controller.signal).then(
      (forecast) => {
        if (!controller.signal.aborted) setTempForecast(forecast);
      },
      () => {
        if (!controller.signal.aborted) setTempFailed(true);
      },
    );
    return () => controller.abort();
  }, [baseTime, layers.temp, tempForecast, tempFailed]);

  // 실시간 바람·파도·기온 격자. 왼쪽 '지금 바다 상태'와 바람·파도·기온 레이어가 함께 쓴다.
  useEffect(() => {
    let alive = true;
    loadLiveGrid().then(
      (grid) => alive && setLiveGrid(grid),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);

  const spotsRes = useApi({ kind: 'spots', time });
  const lastSpots = useLastReady('spots');
  const allSpots = spotsRes.status === 'ready' ? spotsRes.data.spots : (lastSpots?.spots ?? NO_SPOTS);
  const zonesRes = useApi<'zoneGrades'>({ kind: 'zoneGrades', time });
  const lastZones = useLastReady('zoneGrades');
  const zoneGrades = zonesRes.status === 'ready' ? zonesRes.data.grades : (lastZones?.grades ?? {});
  const alerts = useRegionAlerts(allSpots[0]?.id ?? null, baseTime, HOURS_AHEAD, time);
  const alert = alerts[0] ?? null;

  const visibleSpots = useMemo(
    () => allSpots.filter((s) => (types.length === 0 || types.includes(s.type)) && (!safeOnly || s.grade === 'safe')),
    [allSpots, types, safeOnly],
  );
  const counts = useMemo(() => {
    const c: Record<Grade, number> = { safe: 0, caution: 0, danger: 0 };
    for (const s of allSpots) c[s.grade] += 1;
    return c;
  }, [allSpots]);
  const matches = query.trim()
    ? allSpots.filter((s) => s.name.includes(query.trim()) || TYPE_PLAIN[s.type].includes(query.trim())).slice(0, 6)
    : [];

  const flyTo = (lng: number, lat: number) => {
    cam.current = { ...cam.current, lng, lat };
    if (mapMode === '2d') setFocus((f) => ({ lng, lat, key: (f?.key ?? 0) + 1 }));
    else setView((v) => ({ ...v, longitude: lng, latitude: lat - 0.0015, zoom: 16.6, pitch: 60 }));
  };

  const switchMode = () => {
    const { lng, lat, zoom } = cam.current;
    if (mapMode === '2d') {
      // 3D는 비스듬히 보므로 화면 가운데가 같은 곳이 되도록 조금 남쪽에 카메라를 둔다.
      setView({ ...OVERVIEW, longitude: lng, latitude: lat - 0.004, zoom: Math.max(zoom, 14) });
      setMapMode('3d');
    } else {
      setFocus((f) => ({ lng, lat, zoom, key: (f?.key ?? 0) + 1 }));
      setMapMode('2d');
    }
  };

  const selectSpot = (id: string, at?: { lng: number; lat: number }) => {
    setSelectedId(id);
    setQuery('');
    setSheet((s) => (s === 'peek' ? 'half' : s));
    const p = at ?? allSpots.find((s) => s.id === id);
    if (p) flyTo(p.lng, p.lat);
    if (tab !== 'map') router.push('/');
  };
  const pickItem = (item: RecommendationItem) => selectSpot(item.id, item);

  const closeSpot = () => {
    setSelectedId(null);
    setSheet('peek');
  };

  // 시범 지역은 미국이라 실제 위치는 대부분 범위 밖이다. 체험용으로 정한 위치를 '내 위치'로 쓴다.
  const locate = () => flyTo(DEMO_LOCATION.lng, DEMO_LOCATION.lat);

  // 레이어는 켜고 끄기만 한다. 지도는 움직이지 않는다.
  const changeLayers = (requested: LayerState) => {
    // 파도 높이와 기온은 둘 다 지도를 색으로 덮는다. 겹치면 읽을 수 없으므로 새로 켠 쪽만 남긴다.
    const next = { ...requested };
    if (next.temp && !layers.temp) next.waves = false;
    if (next.waves && !layers.waves) next.temp = false;
    setLayers(next);
  };

  const mapLight = mapMode === '3d' && (mapStats?.mode === 'light' || !photoreal);

  // 예보를 아직 못 받았으면, 막대가 지금 시각일 때에 한해 실시간 값으로 대신 그린다.
  const tempField = layers.temp
    ? (tempForecast?.get(Date.parse(time) / 1000) ?? (!tempForecast && index === 0 ? liveGrid : null))
    : null;

  return (
    <div className="ex" ref={rootRef} data-sheet={sheet} data-alert={alert ? 'yes' : 'no'} data-map={mapMode}>
      <div className="ex__map">
        {mapMode === '2d' ? (
          <MapView
            spots={visibleSpots}
            selectedId={selectedId}
            onSelect={(id) => selectSpot(id)}
            zoneGrades={zoneGrades}
            zonesGeoJson={USE_FIXTURES ? ZONES : null}
            layers={layers}
            mode="2d"
            focus={focus}
            onMove={(m) => {
              cam.current = { ...cam.current, lng: m.lng, lat: m.lat };
            }}
            liveGrid={liveGrid}
            tempField={tempField}
            currents={currents}
            userLocation={DEMO_LOCATION}
            sunAltitude={sunAltitude}
          />
        ) : (
          <PhotorealView
            apiKey={API_KEY}
            photoreal={photoreal}
            view={view}
            spots={visibleSpots}
            zones={layers.zones ? ZONES : NO_ZONES}
            grades={zoneGrades}
            onCredits={setCredits}
            onStats={setMapStats}
            onError={() => undefined}
            onSelect={(id) => selectSpot(id)}
            selectedId={selectedId}
            onViewChange={(v) => {
              cam.current = { lng: v.longitude, lat: v.latitude + 0.004, zoom: v.zoom };
            }}
            userLocation={DEMO_LOCATION}
          />
        )}
      </div>

      {/* 위: 검색, 칩, 특보 */}
      <div className="ex-top">
        <div className="ex-searchrow">
          <div className="ex-search" role="search">
            <span className="ex-search__mark" aria-hidden="true">
              <GradeIcon grade="safe" size={22} />
            </span>
            <input
              className="ex-search__input"
              type="search"
              placeholder="낚시할 곳 검색"
              aria-label="낚시할 곳 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query ? (
              <button type="button" className="ex-icon-btn" aria-label="검색어 지우기" onClick={() => setQuery('')}>
                <ExIcon name="close" size={20} />
              </button>
            ) : (
              <ExIcon name="search" size={20} />
            )}
          </div>
        </div>

        {matches.length > 0 && (
          <ul className="ex-results" aria-label="검색 결과">
            {matches.map((s) => (
              <li key={s.id}>
                <button type="button" className="ex-row" onClick={() => selectSpot(s.id, s)}>
                  <GradeIcon grade={s.grade} size={26} />
                  <span className="ex-row__text">
                    <span className="ex-row__title">{s.name}</span>
                    <span className="ex-row__meta">
                      {TYPE_PLAIN[s.type]} · {GRADE_SHORT[s.grade]}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="ex-chips" role="group" aria-label="보고 싶은 곳 고르기">
          <button type="button" className="ex-chip ex-chip--safe" aria-pressed={safeOnly} onClick={() => setSafeOnly((v) => !v)}>
            <GradeIcon grade="safe" size={18} />
            안전한 곳만
          </button>
          {TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className="ex-chip"
              aria-pressed={types.includes(t)}
              onClick={() => setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))}
            >
              <ExIcon name={TYPE_ICON[t]} size={18} />
              {TYPE_PLAIN[t]}
            </button>
          ))}
        </div>

        {alert && (
          <p className="ex-alert" role="status">
            <ExIcon name="warn" size={18} />
            <span>
              <b>기상 특보</b> {alert.headline.replace(/ 발효 중$/, '')} · {formatPlaceTime(alert.expires, baseTime)}까지
            </span>
          </p>
        )}
      </div>

      {/* 왼쪽: 지금 바다 상태 */}
      {live && (live.waveHeight !== null || live.windSpeed !== null) && (
        <aside className="ex-weather" aria-label="지금 바다 상태">
          {live.waveHeight !== null && <WeatherItem icon="wave" name="파도" value={waveLevel(live.waveHeight)} />}
          {live.windSpeed !== null && <WeatherItem icon="wind" name="바람" value={windLevel(live.windSpeed)} />}
        </aside>
      )}

      {/* 오른쪽 위: 레이어, 2D·3D 전환 */}
      <div className="ex-tools">
        <LayerMenu layers={layers} onChange={changeLayers} mode={mapMode} />
        {/* 버튼 글자는 누르면 바뀔 보기다: 2D에서는 '3D', 3D에서는 '2D' */}
        <button
          type="button"
          className="ex-fab ex-fab--text"
          aria-label={mapMode === '3d' ? '평면 지도(2D)로 보기' : '실사 3D로 보기'}
          onClick={switchMode}
        >
          {mapMode === '3d' ? '2D' : '3D'}
        </button>
      </div>

      {/* 켠 레이어의 색 설명 (2D에서만) */}
      {mapMode === '2d' && (layers.waves || layers.temp || layers.currents) && (
        <div className="ex-legend" role="status">
          {layers.waves && (
            <p>
              파도 높이
              <span className="ex-legend__bar" style={{ background: WAVE_GRADIENT }} aria-hidden="true" />
              낮음 → 높음
            </p>
          )}
          {layers.temp && (
            <p>
              기온
              <span className="ex-legend__bar" style={{ background: TEMP_GRADIENT }} aria-hidden="true" />
              추움 → 더움
            </p>
          )}
          {layers.currents && (
            <p>
              {currentFailed ? (
                <>
                  바닷물 흐름을 불러오지 못했어요.{' '}
                  <button type="button" className="ex-link" onClick={() => setCurrentFailed(false)}>
                    다시 시도
                  </button>
                </>
              ) : !currentForecast ? (
                '바닷물 흐름을 불러오는 중…'
              ) : currents?.length ? (
                '청록색 점이 바닷물이 흐르는 방향이에요'
              ) : (
                '이 시간에는 바닷물 흐름 정보가 없어요'
              )}
            </p>
          )}
        </div>
      )}

      {/* 오른쪽 아래: 내 위치 */}
      <div className="ex-side">
        <button type="button" className="ex-fab" aria-label="내 위치" onClick={locate}>
          <ExIcon name="locate" />
        </button>
      </div>

      {/* 아래: 시트 */}
      <section className="ex-sheet" ref={sheetRef} aria-label="내용">
        <button
          type="button"
          className="ex-sheet__handle"
          aria-label={sheet === 'full' ? '접기' : '펼치기'}
          onClick={() => setSheet((s) => NEXT_SHEET[s])}
        >
          <span />
        </button>

        <div className="ex-time" role="group" aria-label="언제 가세요?">
          <p className="ex-time__label">
            <ExIcon name="clock" size={18} />
            <b>{plainTime(time, baseTime)}</b> 기준
          </p>
          <div className="ex-time__chips">
            {quick.map((q) => (
              <button
                key={q.label}
                type="button"
                className="ex-chip ex-chip--small"
                aria-pressed={index === q.index}
                onClick={() => setIndex(q.index)}
              >
                {q.label}
              </button>
            ))}
          </div>
          <input
            className="ex-time__slider"
            type="range"
            min={0}
            max={MAX_INDEX}
            value={index}
            aria-label="시간 고르기"
            aria-valuetext={plainTime(time, baseTime)}
            onChange={(e) => setIndex(Number(e.target.value))}
          />
        </div>

        <div className="ex-sheet__body">
          {tab === 'map' && selectedId && (
            <SpotCard
              key={selectedId}
              spotId={selectedId}
              baseTime={baseTime}
              index={index}
              hours={HOURS_AHEAD}
              center={{ lng: PILOT.center[0], lat: PILOT.center[1] }}
              onIndexChange={setIndex}
              onClose={closeSpot}
              onPick={pickItem}
            />
          )}

          {tab === 'map' && !selectedId && (
            <div className="ex-card ex-card--summary">
              <ul className="ex-counts" aria-label="곳 수">
                {(['safe', 'caution', 'danger'] as Grade[]).map((g) => (
                  <li key={g}>
                    <GradeIcon grade={g} size={20} />
                    {GRADE_SHORT[g]} <b>{counts[g]}</b>
                  </li>
                ))}
              </ul>
              <p className="ex-hint">지도의 표시를 누르면 자세히 볼 수 있어요.</p>
            </div>
          )}

          {tab === 'recommend' && (
            <div className="ex-card">
              <h2 className="ex-card__title">안전한 곳</h2>
              <p className="ex-card__sub">{plainTime(time, baseTime)} 기준으로 덜 위험하고 가기 쉬운 곳이에요.</p>
              <SafeList
                time={time}
                center={{ lng: PILOT.center[0], lat: PILOT.center[1] }}
                alertActive={Boolean(alert)}
                onPick={pickItem}
              />
            </div>
          )}

          {tab === 'saved' && (
            <SavedList spots={allSpots} timeLabel={plainTime(time, baseTime)} onPick={(s) => selectSpot(s.id, s)} />
          )}

          {tab === 'settings' && (
            <div className="ex-card ex-card--info">
              <SettingsPanel />
            </div>
          )}
        </div>
      </section>

      {/* 아래 메뉴 */}
      <nav className="ex-nav" aria-label="메뉴">
        {NAV.map((n) => (
          <button
            key={n.tab}
            type="button"
            className="ex-nav__item"
            aria-current={tab === n.tab ? 'page' : undefined}
            onClick={() => {
              if (n.tab === 'map') setSelectedId(null);
              router.push(n.href);
            }}
          >
            <ExIcon name={n.icon} size={24} filled={n.icon === 'star' && tab === n.tab} />
            {n.label}
          </button>
        ))}
      </nav>

      <p className="ex-credits">
        {mapMode === '2d' ? (
          'OpenFreeMap © OpenMapTiles · Data from OpenStreetMap'
        ) : mapLight ? (
          'USDA, USGS The National Map'
        ) : (
          <>
            <b>Google</b>
            {credits && ` · ${credits}`}
          </>
        )}
        {' · '}
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
          Weather data by Open-Meteo.com
        </a>
      </p>
    </div>
  );
}
