'use client';

// 가기 좋은 곳 목록(추천 API). 지도 앱의 장소 목록처럼 한 줄에 이름, 상태, 걸리는 시간만 보여 준다.

import { GradeIcon } from '@/components/spot/RiskBadge';
import { retry, useApi, type ApiRequest } from '@/lib/hooks/api';
import type { RecommendationItem } from '@/lib/contract/types';
import { GRADE_SHORT, TYPE_PLAIN } from '@/lib/ui/plain';

interface Props {
  time: string;
  center: { lng: number; lat: number };
  excludeSpotId?: string;
  /** 경보가 있으면 모든 곳이 위험이라 추천하지 않는다 */
  alertActive: boolean;
  onPick: (item: RecommendationItem) => void;
}

export default function SafeList({ time, center, excludeSpotId, alertActive, onPick }: Props) {
  const req: Extract<ApiRequest, { kind: 'recommendations' }> = {
    kind: 'recommendations',
    lat: center.lat,
    lng: center.lng,
    time,
    radiusKm: 30,
    ...(excludeSpotId ? { excludeSpotId } : {}),
  };
  const res = useApi(alertActive ? null : req);

  if (alertActive) {
    return <p className="ex-empty">기상 특보가 끝날 때까지는 추천할 곳이 없어요. 다른 시간을 골라 보세요.</p>;
  }
  if (res.status === 'loading') {
    return (
      <ul className="ex-list" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <li key={i} className="ex-skeleton" />
        ))}
      </ul>
    );
  }
  if (res.status === 'error') {
    return (
      <p className="ex-empty">
        목록을 불러오지 못했어요.{' '}
        <button type="button" className="ex-link" onClick={() => retry(req)}>
          다시 시도
        </button>
      </p>
    );
  }
  if (res.data.items.length === 0) {
    return <p className="ex-empty">이 시간에는 추천할 곳이 없어요. 다른 시간을 골라 보세요.</p>;
  }
  return (
    <ul className="ex-list">
      {res.data.items.map((item) => (
        <li key={item.id}>
          <button type="button" className="ex-row" onClick={() => onPick(item)}>
            <GradeIcon grade={item.grade} size={34} />
            <span className="ex-row__text">
              <span className="ex-row__title">{item.name}</span>
              <span className="ex-row__meta">
                <b className={`ex-grade-text ex-grade-text--${item.grade}`}>{GRADE_SHORT[item.grade]}</b> · {TYPE_PLAIN[item.type]} · 걸어서{' '}
                {item.walkMinutes}분
              </span>
              <span className="ex-row__reason">{item.reason}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
