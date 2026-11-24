'use client';

import type { MouseEvent } from 'react';
import { Icon, RiskBadge } from './RiskBadge';
import { retry, useApi, type ApiRequest } from '@/lib/hooks/api';
import type { HourlyRisk } from '@/lib/contract/types';
import { CONFIDENCE_LABEL, FLOOD_LABEL, GRADE_LABEL, SAFETY_NOTICE, TYPE_LABEL } from '@/lib/ui/labels';
import { formatPlaceTime } from '@/lib/ui/time';

interface Props {
  spotId: string;
  baseTime: string;
  index: number;
  hours: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onRecommend: () => void;
}

function RiskStrip({ hourly, index, onPick }: { hourly: HourlyRisk[]; index: number; onPick: (i: number) => void }) {
  const next24 = hourly.slice(0, 24);
  const count = (g: HourlyRisk['grade']) => next24.filter((h) => h.grade === g).length;
  const summary = `앞으로 24시간 중 위험 ${count('danger')}시간, 주의 ${count('caution')}시간, 안전 ${count('safe')}시간`;
  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientX - rect.left) / rect.width) * hourly.length);
    onPick(Math.min(hourly.length - 1, Math.max(0, i)));
  };
  return (
    <>
      <div className="strip" role="img" aria-label={summary} onClick={handleClick}>
        {hourly.map((h, i) => (
          <span key={h.time} className={`strip__cell strip__cell--${h.grade}${i === index ? ' is-current' : ''}`} />
        ))}
      </div>
      <div className="strip__ticks" aria-hidden="true">
        <span>지금</span>
        <span>+24시간</span>
        <span>+48시간</span>
        <span>+72시간</span>
      </div>
      <p className="meta">{summary}. 띠를 누르면 그 시각으로 이동합니다.</p>
    </>
  );
}

export default function SpotSheet({ spotId, baseTime, index, hours, onIndexChange, onClose, onRecommend }: Props) {
  const req: Extract<ApiRequest, { kind: 'spotRisk' }> = { kind: 'spotRisk', id: spotId, from: baseTime, hours };
  const res = useApi(req);

  const closeButton = (
    <button type="button" className="icon-btn icon-btn--small sheet-close" aria-label="포인트 상세 닫기" onClick={onClose}>
      <Icon name="close" />
    </button>
  );

  if (res.status === 'loading') {
    return (
      <div className="sheet-body" aria-busy="true" aria-label="포인트 정보를 불러오는 중">
        <header className="sheet-header">
          <div className="skeleton skeleton--title" />
          {closeButton}
        </header>
        <div className="skeleton skeleton--badge" />
        <div className="skeleton skeleton--row" />
        <div className="skeleton skeleton--row" />
        <div className="skeleton skeleton--row" />
      </div>
    );
  }

  if (res.status === 'error') {
    const missing = res.error.code === 'NOT_FOUND' || res.error.code === 'OUT_OF_COVERAGE';
    return (
      <div className="sheet-body">
        <header className="sheet-header">
          <h2 className="sheet-title">{missing ? '분석되지 않은 포인트' : '정보를 불러오지 못했습니다'}</h2>
          {closeButton}
        </header>
        <div className="state" role="alert">
          <p>{missing ? '이 포인트는 아직 분석되지 않았습니다.' : '잠시 뒤 다시 시도해 주세요.'}</p>
          {!missing && (
            <button type="button" className="btn btn--tonal" onClick={() => retry(req)}>
              다시 시도
            </button>
          )}
        </div>
      </div>
    );
  }

  const { spot, terrain, hourly, alerts, forecastFetchedAt, stale, confidence } = res.data;
  const current = hourly[Math.min(index, hourly.length - 1)];
  const timeLabel = formatPlaceTime(current.time, baseTime);

  return (
    <div className="sheet-body">
      <header className="sheet-header">
        <div>
          <h2 className="sheet-title">{spot.name}</h2>
          <p className="sheet-sub">
            {TYPE_LABEL[spot.type]} · {spot.access.from}에서 도보 {spot.access.walkMinutes}분
          </p>
        </div>
        {closeButton}
      </header>

      <RiskBadge grade={current.grade} score={current.score} timeLabel={timeLabel} confidence={confidence} />

      {stale && (
        <p className="banner banner--warn" role="status">
          데이터 지연: 예보가 6시간 넘게 갱신되지 않았습니다. 실제 상황과 다를 수 있습니다.
        </p>
      )}

      {alerts.map((a) => (
        <p key={`${a.event}-${a.expires}`} className="banner banner--danger" role="alert">
          {a.headline} · {a.source} 발표, {formatPlaceTime(a.expires, baseTime)}까지
        </p>
      ))}

      <section aria-labelledby="causes-title">
        <h3 id="causes-title" className="section-title">
          {GRADE_LABEL[current.grade]} 원인 상위 {current.causes.length}
        </h3>
        <ol className="causes">
          {current.causes.map((c, i) => (
            <li key={c.code}>
              <span className="causes__rank">{i + 1}</span>
              {c.label}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="strip-title">
        <h3 id="strip-title" className="section-title">
          시간대별 위험
        </h3>
        <RiskStrip hourly={hourly} index={index} onPick={onIndexChange} />
      </section>

      <section aria-labelledby="terrain-title">
        <h3 id="terrain-title" className="section-title">
          지형 요약
        </h3>
        <p>
          경사 {terrain.slopeDeg}°, 고도 {terrain.elevationM} m, {terrain.cover}
        </p>
        <p>
          과거 침수 빈도 {FLOOD_LABEL[terrain.floodFrequency]} · 지형 취약성 {terrain.score} / 100
        </p>
        <ul className="factors">
          {terrain.factors.map((f) => (
            <li key={f.code}>{f.label}</li>
          ))}
        </ul>
      </section>

      <p className="meta">
        예보 수집 {formatPlaceTime(forecastFetchedAt, baseTime)} · 신뢰도 {CONFIDENCE_LABEL[confidence]}
        {stale && <span className="tag tag--warn">데이터 지연</span>}
      </p>

      <div className="sheet-actions">
        <button type="button" className="btn btn--filled" onClick={onRecommend}>
          더 안전한 곳 추천
        </button>
      </div>

      <p className="notice">{SAFETY_NOTICE}</p>
    </div>
  );
}
