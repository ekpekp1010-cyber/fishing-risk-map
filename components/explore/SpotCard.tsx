'use client';

// 포인트를 눌렀을 때 아래에서 올라오는 카드. 지도 앱의 장소 카드처럼
// 이름 → 지금 상태 한마디 → 이유 3개 → 시간별 띠 → 버튼 순서로, 꼭 필요한 것만 보여 준다.

import { useState } from 'react';
import { ExIcon } from './icons';
import SafeList from './SafeList';
import { GradeIcon } from '@/components/spot/RiskBadge';
import { retry, useApi, type ApiRequest } from '@/lib/hooks/api';
import { useSavedSpots } from '@/lib/ui/saved';
import type { RecommendationItem } from '@/lib/contract/types';
import { CONFIDENCE_PLAIN, GRADE_ACTION, plainCause, plainTime, SAFETY_PLAIN, TYPE_PLAIN, walkText } from '@/lib/ui/plain';
import { formatPlaceTime } from '@/lib/ui/time';

interface Props {
  spotId: string;
  baseTime: string;
  index: number;
  hours: number;
  center: { lng: number; lat: number };
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onPick: (item: RecommendationItem) => void;
}

export default function SpotCard({ spotId, baseTime, index, hours, center, onIndexChange, onClose, onPick }: Props) {
  const [showSafer, setShowSafer] = useState(false);
  const { isSaved, toggle } = useSavedSpots();
  const saved = isSaved(spotId);
  const req: Extract<ApiRequest, { kind: 'spotRisk' }> = { kind: 'spotRisk', id: spotId, from: baseTime, hours };
  const res = useApi(req);

  if (res.status === 'loading') {
    return (
      <div className="ex-card" aria-busy="true">
        <div className="ex-skeleton ex-skeleton--title" />
        <div className="ex-skeleton ex-skeleton--big" />
        <div className="ex-skeleton" />
      </div>
    );
  }
  if (res.status === 'error') {
    return (
      <div className="ex-card">
        <p className="ex-empty">
          이곳 정보를 불러오지 못했어요.{' '}
          <button type="button" className="ex-link" onClick={() => retry(req)}>
            다시 시도
          </button>
        </p>
      </div>
    );
  }

  const { spot, hourly, alerts, forecastFetchedAt, stale, confidence } = res.data;
  const now = hourly[Math.min(index, hourly.length - 1)];
  const alert = alerts.find((a) => Date.parse(a.expires) > Date.parse(now.time)) ?? null;
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${spot.lat},${spot.lng}`;

  if (showSafer) {
    return (
      <div className="ex-card">
        <header className="ex-card__head">
          <button type="button" className="ex-icon-btn" aria-label="이전으로" onClick={() => setShowSafer(false)}>
            <ExIcon name="back" />
          </button>
          <div>
            <h2 className="ex-card__title">더 안전한 곳</h2>
            <p className="ex-card__sub">{plainTime(now.time, baseTime)} 기준, {spot.name}보다 덜 위험한 곳이에요.</p>
          </div>
        </header>
        <SafeList time={now.time} center={center} excludeSpotId={spot.id} alertActive={Boolean(alert)} onPick={onPick} />
      </div>
    );
  }

  return (
    <div className="ex-card">
      <header className="ex-card__head">
        <div>
          <h2 className="ex-card__title">{spot.name}</h2>
          <p className="ex-card__sub">
            {TYPE_PLAIN[spot.type]} · {walkText(spot.access.walkMinutes, spot.access.from)}
          </p>
        </div>
        <button type="button" className="ex-icon-btn" aria-label="닫기" onClick={onClose}>
          <ExIcon name="close" />
        </button>
      </header>

      <div className={`ex-status ex-status--${now.grade}`} role="status" aria-live="polite">
        <GradeIcon grade={now.grade} size={44} />
        <div>
          <p className="ex-status__action">{GRADE_ACTION[now.grade]}</p>
          <p className="ex-status__when">{plainTime(now.time, baseTime)} 기준</p>
        </div>
      </div>

      {alert && (
        <p className="ex-alert ex-alert--inline">
          <ExIcon name="warn" size={18} />
          {alert.headline} · {formatPlaceTime(alert.expires, baseTime)}까지
        </p>
      )}

      <section aria-label="이유">
        <h3 className="ex-h3">왜 그런가요?</h3>
        <ol className="ex-causes">
          {now.causes.map((c) => {
            const p = plainCause(c);
            return (
              <li key={c.code + c.label}>
                <span>{p.text}</span>
                {p.detail && <small>{p.detail}</small>}
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-label="시간별 상태">
        <h3 className="ex-h3">앞으로 3일</h3>
        <div className="ex-strip" role="group" aria-label="시간을 눌러 그때 상태 보기">
          {hourly.map((h, i) => (
            <button
              key={h.time}
              type="button"
              className={`ex-strip__cell ex-strip__cell--${h.grade}`}
              aria-pressed={i === index}
              aria-label={`${formatPlaceTime(h.time, baseTime)} ${GRADE_ACTION[h.grade]}`}
              onClick={() => onIndexChange(i)}
            />
          ))}
        </div>
        <div className="ex-strip__axis" aria-hidden="true">
          <span>지금</span>
          <span>내일</span>
          <span>모레</span>
          <span>3일 뒤</span>
        </div>
      </section>

      <div className="ex-actions">
        {now.grade !== 'safe' && (
          <button type="button" className="ex-btn ex-btn--primary" onClick={() => setShowSafer(true)}>
            <ExIcon name="shield" size={18} />더 안전한 곳
          </button>
        )}
        <button
          type="button"
          className="ex-btn"
          aria-pressed={saved}
          onClick={() => toggle({ id: spot.id, name: spot.name, type: spot.type, lat: spot.lat, lng: spot.lng })}
        >
          <span className={saved ? 'ex-star ex-star--on' : 'ex-star'}>
            <ExIcon name="star" size={18} filled={saved} />
          </span>
          {saved ? '저장됨' : '저장'}
        </button>
        <a className="ex-btn" href={directions} target="_blank" rel="noreferrer">
          <ExIcon name="route" size={18} />길찾기
        </a>
      </div>

      {(stale || CONFIDENCE_PLAIN[confidence]) && (
        <p className="ex-note">
          {stale && `날씨 정보가 늦게 들어오고 있어요(${formatPlaceTime(forecastFetchedAt, baseTime)} 기준). `}
          {CONFIDENCE_PLAIN[confidence]}
        </p>
      )}
      <p className="ex-note">{SAFETY_PLAIN}</p>
    </div>
  );
}
