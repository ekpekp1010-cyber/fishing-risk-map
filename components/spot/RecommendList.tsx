'use client';

import { GradeIcon, Icon } from './RiskBadge';
import { retry, useApi, type ApiRequest } from '@/lib/hooks/api';
import type { RecommendationItem } from '@/lib/ui/api-types';
import { GRADE_LABEL, SAFETY_NOTICE, TYPE_LABEL } from '@/lib/ui/labels';

interface Props {
  title: string;
  lead: string;
  time: string;
  center: { lat: number; lng: number };
  excludeSpotId?: string;
  onPick: (item: RecommendationItem) => void;
  onBack?: () => void;
}

export default function RecommendList({ title, lead, time, center, excludeSpotId, onPick, onBack }: Props) {
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

      {res.status === 'ready' && res.data.items.length === 0 && (
        <div className="state">
          <p>이 시간대에는 추천할 만한 포인트가 없습니다.</p>
          <p>시간 슬라이더를 움직여 다른 시간대를 확인해 보세요.</p>
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
