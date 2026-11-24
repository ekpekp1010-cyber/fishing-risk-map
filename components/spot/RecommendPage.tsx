'use client';

// 지도 없이도 같은 정보를 얻을 수 있는 목록 화면. 3D 조작이 어려운 사용자를 위한 경로다.

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import RecommendList from './RecommendList';
import { GradeIcon } from './RiskBadge';
import { useApi, useRegionAlerts } from '@/lib/hooks/api';
import { PILOT } from '@/lib/map/config';
import { GRADE_LABEL, TYPE_LABEL } from '@/lib/ui/labels';
import { addHoursIso, floorToHourIso, formatPlaceTime, HOURS_AHEAD } from '@/lib/ui/time';

/** 지도의 시간 슬라이더와 같은 범위(1시간 단위)를 날짜별로 묶는다. */
function hourOptions(baseTime: string) {
  const days: Array<{ day: string; hours: Array<{ offset: number; label: string }> }> = [];
  for (let offset = 0; offset < HOURS_AHEAD; offset += 1) {
    const label = formatPlaceTime(addHoursIso(baseTime, offset), baseTime);
    const day = label.slice(0, label.lastIndexOf(' '));
    if (days.at(-1)?.day !== day) days.push({ day, hours: [] });
    days.at(-1)!.hours.push({ offset, label });
  }
  return days;
}

export default function RecommendPage() {
  const router = useRouter();
  const [baseTime] = useState(() => floorToHourIso(new Date()));
  const [index, setIndex] = useState(0);
  const time = addHoursIso(baseTime, index);
  const spotsRes = useApi<'spots'>({ kind: 'spots', time });
  const firstSpotId = spotsRes.status === 'ready' ? (spotsRes.data.spots[0]?.id ?? null) : null;
  const alert = useRegionAlerts(firstSpotId, baseTime, HOURS_AHEAD, time)[0] ?? null;
  const days = useMemo(() => hourOptions(baseTime), [baseTime]);

  const openOnMap = (p: { id: string; lng: number; lat: number }) =>
    router.push(`/?spot=${encodeURIComponent(p.id)}&t=${index}&lng=${p.lng}&lat=${p.lat}`);

  return (
    <div className="page">
      <h1 className="page__title">추천 포인트</h1>
      <p className="page__lead">{PILOT.name} 해안에서 위험이 낮고 접근이 쉬운 곳을 시간대별로 보여 줍니다.</p>

      <label className="field">
        <span>시간대 (현지 시각)</span>
        <select value={index} onChange={(e) => setIndex(Number(e.target.value))}>
          {days.map((d) => (
            <optgroup key={d.day} label={d.day}>
              {d.hours.map((h) => (
                <option key={h.offset} value={h.offset}>
                  {h.label}
                  {h.offset === 0 ? ' (지금)' : ` (+${h.offset}시간)`}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <section className="card">
        <RecommendList
          title="이 시간대 추천"
          lead="항목을 누르면 지도에서 해당 포인트를 엽니다."
          time={time}
          baseTime={baseTime}
          center={{ lng: PILOT.center[0], lat: PILOT.center[1] }}
          alert={alert}
          emptyHint="위의 시간대를 바꿔 다른 시각을 확인해 보세요."
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
