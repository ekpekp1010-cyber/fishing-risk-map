'use client';

// 실사 3D 시험 화면(docs/redesign-plan.md 0단계, 4.5). 실사 3D 타일이 시범 지역에서 어떻게 보이는지,
// 구역을 표면에 덮었을 때 어떤지, 얼마나 빨리 뜨는지, 타일 요청이 몇 건인지 본다.
// 주소에 ?mode=light를 붙이면 실사 없이 가벼운 지도(대체 경로)만 본다.

import { useEffect, useMemo, useState } from 'react';
import { preconnect } from 'react-dom';
import type { MapViewState } from '@deck.gl/core';
// 이 화면 자체가 브라우저에서만 불러와지므로(PhotorealLabLoader) 지도는 바로 가져온다.
// 여기서 한 번 더 나눠 불러오면 자바스크립트를 두 번 차례로 받느라 지도가 늦게 뜬다.
import PhotorealView, { type FallbackReason, type PhotorealStats } from './PhotorealView';
import { MAP_CONFIG, PILOT } from '@/lib/map/config';
import { ensureRealForecast, fixtureSpots, fixtureZoneGrades, fixtureZonesGeoJson } from '@/lib/ui/dev-fixtures';
import { floorToHourIso } from '@/lib/ui/time';
import { GRADE_LABEL } from '@/lib/ui/labels';

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

const OVERVIEW: MapViewState = {
  longitude: PILOT.center[0],
  latitude: PILOT.center[1] - 0.012,
  zoom: 14.2,
  pitch: 60,
  bearing: -24,
};

const FALLBACK_LABEL: Record<FallbackReason, string> = {
  off: '가벼운 지도(데이터 절약)',
  error: '가벼운 지도(실사 오류)',
  timeout: '가벼운 지도(실사 시간 초과)',
};

const sec = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)}초`);

/** 실사 타일을 받을지. 브라우저가 데이터 절약을 알리거나 주소에 ?mode=light가 있으면 받지 않는다. */
function wantsPhotoreal(): boolean {
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  const forcedLight = new URLSearchParams(location.search).get('mode') === 'light';
  return !saveData && !forcedLight;
}

export default function PhotorealLab() {
  const [time] = useState(() => floorToHourIso(new Date()));
  const [photoreal] = useState(wantsPhotoreal);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<MapViewState>(OVERVIEW);
  const [credits, setCredits] = useState('');
  const [stats, setStats] = useState<PhotorealStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 실사 타일 서버와 미리 연결해 첫 요청의 연결 시간을 줄인다.
  if (photoreal) preconnect('https://tile.googleapis.com', { crossOrigin: 'anonymous' });

  useEffect(() => {
    ensureRealForecast().then(() => setReady(true));
  }, []);

  const spots = useMemo(() => (ready ? fixtureSpots(time).spots : []), [ready, time]);
  const grades = useMemo(() => (ready ? fixtureZoneGrades(time).grades : {}), [ready, time]);
  const zones = useMemo(() => fixtureZonesGeoJson(), []);

  if (!API_KEY) {
    return (
      <div className="lab lab--empty">
        <h1>실사 3D 시험 화면</h1>
        <p>
          Google Map Tiles API 키가 없습니다. <code>.env.local</code>에 <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>를 넣고
          개발 서버를 다시 켜세요.
        </p>
      </div>
    );
  }

  const flyTo = (lng: number, lat: number) => setView({ longitude: lng, latitude: lat, zoom: 17.2, pitch: 62, bearing: view.bearing });
  const isPhotoreal = (stats?.mode ?? (photoreal ? 'photoreal' : 'light')) === 'photoreal';

  return (
    <div className="lab">
      <PhotorealView
        apiKey={API_KEY}
        photoreal={photoreal}
        view={view}
        spots={spots}
        zones={zones}
        grades={grades}
        onCredits={setCredits}
        onStats={setStats}
        onError={setError}
      />

      <section className="lab__panel" aria-label="시험 측정값">
        <h1>실사 3D 시험</h1>
        {error && <p className="lab__error" role="alert">{error}</p>}
        <dl>
          <dt>지금 보기</dt>
          <dd>{stats?.fallbackReason ? FALLBACK_LABEL[stats.fallbackReason] : isPhotoreal ? '실사' : FALLBACK_LABEL.off}</dd>
          {isPhotoreal ? (
            <>
              <dt>루트 타일셋</dt>
              <dd>{sec(stats?.tilesetLoadedAt ?? null)}</dd>
              <dt>첫 실사 타일</dt>
              <dd>{sec(stats?.firstTileAt ?? null)}</dd>
              <dt>받은 실사 타일</dt>
              <dd>{stats?.tilesLoaded ?? 0}건</dd>
              <dt>타일 오류</dt>
              <dd>{stats?.tileErrors ?? 0}건</dd>
            </>
          ) : (
            <>
              <dt>가벼운 지도</dt>
              <dd>{sec(stats?.lightReadyAt ?? null)}</dd>
            </>
          )}
        </dl>
        <button type="button" className="btn btn--tonal" onClick={() => setView({ ...OVERVIEW })}>
          개요
        </button>
        <ol className="lab__spots">
          {spots.map((s) => (
            <li key={s.id}>
              <button type="button" className="btn btn--text" onClick={() => flyTo(s.lng, s.lat)}>
                {s.name} · {GRADE_LABEL[s.grade]}
              </button>
            </li>
          ))}
        </ol>
      </section>

      <p className="lab__credits">
        {isPhotoreal ? (
          <>
            <strong>Google</strong>
            {credits && ` · ${credits}`}
          </>
        ) : (
          MAP_CONFIG.satelliteAttribution || '항공 사진'
        )}
      </p>
    </div>
  );
}
