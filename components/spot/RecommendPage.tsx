'use client';

// 지도 없이도 같은 정보를 얻을 수 있는 목록 화면. 3D 조작이 어려운 사용자를 위한 경로다.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import RecommendList from './RecommendList';
import { GradeIcon } from './RiskBadge';
import { useApi } from '@/lib/hooks/api';
import { PILOT } from '@/lib/map/config';
import { GRADE_LABEL, TYPE_LABEL } from '@/lib/ui/labels';
import { addHoursIso, floorToHourIso, formatPlaceTime, HOURS_AHEAD } from '@/lib/ui/time';

const OFFSETS = [0, 3, 6, 12, 24, 36, 48, HOURS_AHEAD - 1];

export default function RecommendPage() {
  const router = useRouter();
  const [baseTime] = useState(() => floorToHourIso(new Date()));
  const [index, setIndex] = useState(0);
  const time = addHoursIso(baseTime, index);
  const spotsRes = useApi<'spots'>({ kind: 'spots', time });

  const openOnMap = (p: { id: string; lng: number; lat: number }) =>
    router.push(`/?spot=${encodeURIComponent(p.id)}&t=${index}&lng=${p.lng}&lat=${p.lat}`);

  return (
    <div className="page">
      <h1 className="page__title">추천 포인트</h1>
      <p className="page__lead">{PILOT.name} 해안에서 위험이 낮고 접근이 쉬운 곳을 시간대별로 보여 줍니다.</p>

      <label className="field">
        <span>시간대 (현지 시각)</span>
        <select value={index} onChange={(e) => setIndex(Number(e.target.value))}>
          {OFFSETS.map((o) => (
            <option key={o} value={o}>
              {formatPlaceTime(addHoursIso(baseTime, o), baseTime)}
              {o === 0 ? ' (지금)' : ` (+${o}시간)`}
            </option>
          ))}
        </select>
      </label>

      <section className="card">
        <RecommendList
          title="이 시간대 추천"
          lead="항목을 누르면 지도에서 해당 포인트를 엽니다."
          time={time}
          center={{ lng: PILOT.center[0], lat: PILOT.center[1] }}
          onPick={openOnMap}
        />
      </section>

      <section className="card" aria-labelledby="all-spots-title">
        <div className="sheet-body">
          <h2 id="all-spots-title" className="sheet-title">
            모든 포인트
          </h2>
          <p className="sheet-sub">위험 점수가 낮은 순서입니다.</p>
          {spotsRes.status === 'loading' && <div className="skeleton skeleton--row" aria-busy="true" />}
          {spotsRes.status === 'error' && (
            <p className="state" role="alert">
              포인트를 불러오지 못했습니다.
            </p>
          )}
          {spotsRes.status === 'ready' && (
            <ol className="list">
              {[...spotsRes.data.spots]
                .sort((a, b) => a.score - b.score)
                .map((s) => (
                  <li key={s.id}>
                    <button type="button" className="list-item" onClick={() => openOnMap(s)}>
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
        </div>
      </section>
    </div>
  );
}
