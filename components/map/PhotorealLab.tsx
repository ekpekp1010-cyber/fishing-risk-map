'use client';

// 0단계 확인용 시험 화면(docs/redesign-plan.md). 실사 3D 타일이 시범 지역에 있는지,
// 구역을 표면에 덮었을 때 어떻게 보이는지, 얼마나 빨리 뜨는지, 타일 요청이 몇 건인지 본다.

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import type { MapViewState } from '@deck.gl/core';
import type { PhotorealStats } from './PhotorealView';
import { PILOT } from '@/lib/map/config';
import { ensureRealForecast, fixtureSpots, fixtureZoneGrades, fixtureZonesGeoJson } from '@/lib/ui/dev-fixtures';
import { floorToHourIso } from '@/lib/ui/time';
import { GRADE_LABEL } from '@/lib/ui/labels';

const PhotorealView = dynamic(() => import('./PhotorealView'), { ssr: false });

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

const OVERVIEW: MapViewState = {
  longitude: PILOT.center[0],
  latitude: PILOT.center[1] - 0.012,
  zoom: 14.2,
  pitch: 60,
  bearing: -24,
};

const sec = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)}초`);

export default function PhotorealLab() {
  const [time] = useState(() => floorToHourIso(new Date()));
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<MapViewState>(OVERVIEW);
  const [credits, setCredits] = useState('');
  const [stats, setStats] = useState<PhotorealStats | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="lab">
      <PhotorealView
        apiKey={API_KEY}
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
          <dt>루트 타일셋</dt>
          <dd>{sec(stats?.tilesetLoadedAt ?? null)}</dd>
          <dt>첫 타일</dt>
          <dd>{sec(stats?.firstTileAt ?? null)}</dd>
          <dt>받은 타일</dt>
          <dd>{stats?.tilesLoaded ?? 0}건</dd>
          <dt>타일 오류</dt>
          <dd>{stats?.tileErrors ?? 0}건</dd>
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
        <strong>Google</strong>
        {credits && ` · ${credits}`}
      </p>
    </div>
  );
}
