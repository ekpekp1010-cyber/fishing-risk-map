'use client';

import { GradeIcon, Icon } from './RiskBadge';
import { retry, useApi, type ApiRequest } from '@/lib/hooks/api';
import type { RecommendationItem, RiskAlert } from '@/lib/contract/types';
import { GRADE_LABEL, SAFETY_NOTICE, TYPE_LABEL } from '@/lib/ui/labels';
import { addHoursIso, formatPlaceTime, HOURS_AHEAD } from '@/lib/ui/time';

interface Props {
  title: string;
  lead: string;
  time: string;
  /** 화면의 '지금'. 경보 종료 시각을 "내일 04:00"처럼 적는 기준이다. */
  baseTime: string;
  center: { lat: number; lng: number };
  excludeSpotId?: string;
  /** 그 시각에 발효 중인 경보. 있으면 목록이 비는 이유로 보여 준다. */
  alert?: RiskAlert | null;
  /** 목록이 비었을 때 다른 시간대를 고르는 방법. 화면마다 조작이 달라서 받는다. */
  emptyHint?: string;
  onPick: (item: RecommendationItem) => void;
  onBack?: () => void;
}

export default function RecommendList({
  title,
  lead,
  time,
  baseTime,
  center,
  excludeSpotId,
  alert,
  emptyHint = '시간 슬라이더를 움직여 다른 시간대를 확인해 보세요.',
  onPick,
  onBack,
}: Props) {
  // 경보가 고를 수 있는 마지막 시각보다 늦게 끝나면, 시간대를 바꿔도 추천이 나오지 않는다.
  const alertOutlastsWindow =
    alert != null && Date.parse(alert.expires) > Date.parse(addHoursIso(baseTime, HOURS_AHEAD - 1));
  const req: Extract<ApiRequest, { kind: 'recommendations' }> = {
    kind: 'recommendations',
    lat: center.lat,
    lng: center.lng,
    time,
    radiusKm: 30,
    ...(excludeSpotId ? { excludeSpotId } : {}),
  };
  const res = useApi(req);

  return (
    <div className="sheet-body">
      <header className="sheet-header">
        {onBack && (
          <button type="button" className="icon-btn icon-btn--small" aria-label="포인트 상세로 돌아가기" onClick={onBack}>
            <Icon name="back" />
          </button>
        )}
        <div>
          <h2 className="sheet-title">{title}</h2>
          <p className="sheet-sub">{lead}</p>
        </div>
      </header>

      {res.status === 'loading' && (
        <div aria-busy="true" aria-label="추천을 불러오는 중">
          <div className="skeleton skeleton--row" />
          <div className="skeleton skeleton--row" />
          <div className="skeleton skeleton--row" />
        </div>
      )}

      {res.status === 'error' && (
        <div className="state" role="alert">
          <p>추천을 불러오지 못했습니다.</p>
          <button type="button" className="btn btn--tonal" onClick={() => retry(req)}>
            다시 시도
          </button>
        </div>
      )}

      {res.status === 'ready' && res.data.items.length === 0 && alert && (
        <div className="state">
          <p className="banner banner--danger">
            {alert.headline} · {alert.source} 발표, {formatPlaceTime(alert.expires, baseTime)}까지
          </p>
          <p>공식 경보가 발효 중인 시간에는 모든 포인트를 &lsquo;위험&rsquo;으로 표시하므로 추천할 곳이 없습니다.</p>
          <p>
            {alertOutlastsWindow
              ? `경보가 ${HOURS_AHEAD}시간 예보 범위보다 늦게 끝납니다. 경보가 끝날 무렵 다시 확인해 주세요.`
              : '경보가 끝난 뒤의 시간대를 골라 확인해 보세요.'}
          </p>
        </div>
      )}

      {res.status === 'ready' && res.data.items.length === 0 && !alert && (
        <div className="state">
          <p>이 시간대에는 추천할 만한 포인트가 없습니다.</p>
          <p>{emptyHint}</p>
        </div>
      )}

      {res.status === 'ready' && res.data.items.length > 0 && (
        <ol className="list">
          {res.data.items.map((item) => (
            <li key={item.id}>
              <button type="button" className="list-item" onClick={() => onPick(item)}>
                <GradeIcon grade={item.grade} size={32} />
                <span className="list-item__text">
                  <span className="list-item__title">{item.name}</span>
                  <span className="list-item__meta">
                    {GRADE_LABEL[item.grade]} · 점수 {item.score} · {TYPE_LABEL[item.type]} · 도보 {item.walkMinutes}분
                  </span>
                  <span className="list-item__reason">{item.reason}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}

      <p className="notice">{SAFETY_NOTICE}</p>
    </div>
  );
}
