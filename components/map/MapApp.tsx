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
import SpotList from '@/components/spot/SpotList';
import { retry, USE_FIXTURES, useApi, useLastReady, useRegionAlerts, type ApiRequest } from '@/lib/hooks/api';
import { DEFAULT_LAYERS, LIVE, PILOT, inPilotBbox, type LayerState } from '@/lib/map/config';
import { liveSummary, loadLiveGrid, sampleGrid, TEMP_STOPS, WAVE_STOPS, type LiveGrid } from '@/lib/map/live';
import { loadCurrentForecast, type CurrentForecast } from '@/lib/map/currents';
import { loadTempForecast, type TempForecast } from '@/lib/map/temperature';
import { isNight, nightSpans, sunEvents, sunPosition } from '@/lib/map/sun';
import type { Grade, SpotSummary, SpotType } from '@/lib/contract/types';
import { fixtureZonesGeoJson } from '@/lib/ui/dev-fixtures';
import { GRADE_LABEL, SAFETY_NOTICE } from '@/lib/ui/labels';
import { addHoursIso, floorToHourIso, formatClock, formatPlaceTime, HOURS_AHEAD } from '@/lib/ui/time';

const WAVE_MAX = WAVE_STOPS[WAVE_STOPS.length - 1][0];
const WAVE_GRADIENT = `linear-gradient(to right, ${WAVE_STOPS.map(([h, c]) => `${c} ${(h / WAVE_MAX) * 100}%`).join(', ')})`;
/** 넓게 봐야 보이는 실시간 레이어. 켜면 지도가 물러난다. */
const WIDE_LAYERS = ['waves', 'temp', 'radar', 'clouds'] as const;
const TEMP_MIN = TEMP_STOPS[0][0];
const TEMP_MAX = TEMP_STOPS[TEMP_STOPS.length - 1][0];
const TEMP_GRADIENT = `linear-gradient(to right, ${TEMP_STOPS.map(([t, c]) => `${c} ${((t - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)) * 100}%`).join(', ')})`;

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
  const [currentForecast, setCurrentForecast] = useState<CurrentForecast | null>(null);
  const [currentFailed, setCurrentFailed] = useState(false);
  const [tempForecast, setTempForecast] = useState<TempForecast | null>(null);
  const [tempFailed, setTempFailed] = useState(false);
  const [snack, setSnack] = useState<string | null>(
    boot.webgl ? null : '이 기기에서는 3D 지도를 쓸 수 없어 목록으로 보여 드립니다.',
  );

  const time = addHoursIso(baseTime, index);
  const currents = layers.currents ? currentForecast?.get(Date.parse(time) / 1000) : undefined;

  // 밤낮: 시범 지역의 태양 위치를 시각으로 계산한다. 막대가 '지금'이면 정시가 아니라 실제 현재 시각을 쓰고 1분마다 다시 잰다.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const sunDays = useMemo(() => {
    const from = Date.parse(baseTime);
    const [lng, lat] = PILOT.center;
    return {
      // 막대의 마지막 시각 뒤에 오는 해 뜸·해 짐도 알려 줄 수 있게 하루를 더 본다
      events: sunEvents(from, Date.parse(addHoursIso(baseTime, HOURS_AHEAD + 24)), lng, lat),
      nights: nightSpans(from, Date.parse(addHoursIso(baseTime, MAX_INDEX)), lng, lat),
    };
  }, [baseTime]);
  const baseMs = Date.parse(baseTime);
  const sunMs = index === 0 ? Math.min(Math.max(nowMs, baseMs), baseMs + 59 * 60_000) : Date.parse(time);
  const sun = sunPosition(sunMs, PILOT.center[0], PILOT.center[1]);
  const nextSun = sunDays.events.find((e) => e.at > sunMs);
  const sunNote = nextSun
    ? `${nextSun.kind === 'rise' ? '해 뜸' : '해 짐'} ${formatClock(new Date(nextSun.at).toISOString())}`
    : null;

  useEffect(() => {
    if (!layers.currents || currentForecast || currentFailed) return;
    const controller = new AbortController();
    loadCurrentForecast(baseTime, controller.signal).then(
      forecast => { if (!controller.signal.aborted) setCurrentForecast(forecast); },
      () => { if (!controller.signal.aborted) setCurrentFailed(true); },
    );
    return () => controller.abort();
  }, [baseTime, layers.currents, currentForecast, currentFailed]);

  // 기온은 시간 막대에 맞춘다. 72시간 치를 한 번에 받아 두고, 막대를 움직이면 그 시각의 격자를 꺼내 쓴다.
  useEffect(() => {
    if (!boot.webgl || !layers.temp || tempForecast || tempFailed) return;
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
  }, [boot.webgl, baseTime, layers.temp, tempForecast, tempFailed]);

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

  // 실시간 바람·파고·기온: 해당 레이어가 켜져 있을 때만 받는다.
  const needsLive = boot.webgl && (layers.wind || layers.waves || layers.temp);
  useEffect(() => {
    if (!needsLive) return;
    let alive = true;
    loadLiveGrid().then(
      (grid) => {
        if (alive) setLiveGrid(grid);
      },
      () => {
        if (alive) setSnack('실시간 바람·파고·기온을 불러오지 못했습니다.');
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

  const changeLayers = (requested: LayerState) => {
    // 파고와 기온은 둘 다 지도를 색으로 덮는다. 겹치면 색을 읽을 수 없으므로 새로 켠 쪽만 남긴다.
    const next = { ...requested };
    if (next.temp && !layers.temp) next.waves = false;
    if (next.waves && !layers.waves) next.temp = false;
    const turnedOnWide = WIDE_LAYERS.some((k) => next[k] && !layers[k]);
    setLayers(next);
    if (next.currents && !layers.currents) {
      setFocus(f => ({ lng: -124.36, lat: 44.64, zoom: 9, key: (f?.key ?? 0) + 1 }));
    } else if (turnedOnWide) {
      setFocus((f) => ({ lng: PILOT.center[0] - 0.35, lat: PILOT.center[1], zoom: LIVE.regionalZoom, key: (f?.key ?? 0) + 1 }));
    }
  };

  const live = liveGrid && needsLive ? liveSummary(liveGrid, PILOT.center[0], PILOT.center[1]) : null;

  const tempHour = layers.temp ? tempForecast?.get(Date.parse(time) / 1000) : undefined;
  // 예보를 아직 못 받았으면, 막대가 지금 시각일 때에 한해 실시간 값으로 대신 그린다. 다른 시각에는 그리지 않는다.
  const tempField = tempHour ?? (layers.temp && !tempForecast && index === 0 ? liveGrid : null);
  const tempFeels = tempHour
    ? sampleGrid(tempHour, tempHour.feels, PILOT.center[0], PILOT.center[1])
    : tempField
      ? (live?.feelsLike ?? null)
      : null;

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
            tempField={tempField}
            currents={currents}
            sunAltitude={layers.daylight ? sun.altitude : null}
          />
        ) : (
          <div className="nomap" aria-label="포인트 목록">
            <SpotList spots={visibleSpots} onPick={(s) => selectSpot(s.id, s)} />
          </div>
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
              {live.temperature !== null && ` · 기온 ${Math.round(live.temperature)}°C`}
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
          {layers.temp && (
            <p className="wave-legend">
              기온 · {formatPlaceTime(time, baseTime)}
              <span className="wave-legend__bar" style={{ background: TEMP_GRADIENT }} aria-hidden="true" />
              {TEMP_MIN} ~ {TEMP_MAX}°C
              {tempFeels !== null && ` · 체감 ${Math.round(tempFeels)}°C`}
              {tempFailed ? (
                <>
                  {' · 예보 연결 실패 '}
                  <button type="button" onClick={() => setTempFailed(false)}>
                    다시 시도
                  </button>
                </>
              ) : !tempForecast ? (
                ' · 예보를 불러오는 중…'
              ) : (
                !tempHour && ' · 이 시각의 예보가 없습니다'
              )}
            </p>
          )}
          {layers.currents && (
            <div className="current-legend" role="status">
              <strong>표층 해류 · {formatPlaceTime(time, baseTime)}</strong>
              {currentFailed ? (
                <span>예보 연결 실패 <button type="button" onClick={() => setCurrentFailed(false)}>다시 시도</button></span>
              ) : !currentForecast ? (
                <span>해류 예보를 불러오는 중…</span>
              ) : currents?.length ? (
                <span>청록색 입자 · 흐르는 방향과 상대 속도 · 유속 m/s</span>
              ) : (
                <span>이 시각에 제공된 해류 값이 없습니다.</span>
              )}
            </div>
          )}
          {outOfCoverage && (
            <p className="banner banner--float" role="status">
              지도 중심은 낚시 포인트 분석 지역 밖입니다.
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
            nights={sunDays.nights}
            night={isNight(sun.altitude)}
            sunNote={sunNote}
            onChange={(i) => {
              setPlaying(false);
              setIndex(i);
            }}
            onTogglePlay={() => setPlaying((v) => !v)}
          />
        </div>
      </div>

      {/* 지도 위에 뜬 패널 하나에 메뉴와 내용이 함께 들어간다. 좁은 화면에서는 아래에서 올라오는 시트가 된다. */}
      <aside className="sheet" aria-label={tab === 'map' ? (selectedId ? '포인트 상세' : '포인트 현황') : PANEL_LABEL[tab]}>
        <button
          type="button"
          className="sheet__handle"
          onClick={() => setSheet((s) => NEXT_SHEET[s])}
          aria-label={sheet === 'full' ? '시트 접기' : '시트 펼치기'}
        >
          <span />
        </button>
        <NavLinks />
        <div className="sheet__content" key={tab === 'map' ? `${tab}-${selectedId ?? ''}-${panel}` : tab}>
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
          {tab === 'map' && !selectedId && boot.webgl && (
            <section className="sheet-body">
              <header className="sheet-header">
                <div>
                  <h2 className="sheet-title">포인트 현황</h2>
                  <p className="meta">{PILOT.name} · {formatPlaceTime(queryTime, baseTime)} 기준</p>
                </div>
                {spotsRes.status === 'ready' && <span className="spot-count">{visibleSpots.length}곳</span>}
              </header>
              {spotsRes.status === 'loading' && <p className="meta" role="status">포인트를 불러오는 중…</p>}
              {spotsRes.status === 'error' && <p role="alert">포인트 현황을 불러오지 못했습니다.</p>}
              {spotsRes.status === 'ready' && (visibleSpots.length ? (
                <SpotList spots={visibleSpots} onPick={(s) => selectSpot(s.id, s)} />
              ) : (
                <p className="state">현재 조건에 맞는 포인트가 없습니다.</p>
              ))}
              <p className="notice">{SAFETY_NOTICE}</p>
            </section>
          )}
          {tab === 'map' && !selectedId && !boot.webgl && (
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
