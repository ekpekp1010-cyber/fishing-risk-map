'use client';

// 패널의 '추천' 탭. 지도를 조작하지 않아도 같은 정보를 얻을 수 있는 목록이다(3D 조작이 어려운 사용자를 위한 경로).
// 시각은 지도의 시간 막대와 같은 값을 쓴다.

import RecommendList from './RecommendList';
import SpotList from './SpotList';
import { useApi } from '@/lib/hooks/api';
import type { RiskAlert } from '@/lib/contract/types';
import { formatPlaceTime } from '@/lib/ui/time';

interface Props {
  time: string;
  baseTime: string;
  center: { lat: number; lng: number };
  alert: RiskAlert | null;
  /** 고른 포인트를 지도 탭에서 연다. */
  onPick: (spot: { id: string; lng: number; lat: number }) => void;
}

export default function RecommendPage({ time, baseTime, center, alert, onPick }: Props) {
  const spotsRes = useApi<'spots'>({ kind: 'spots', time });

  return (
    <div className="blocks">
      <RecommendList
        title="추천 포인트"
        lead={`${formatPlaceTime(time, baseTime)} 기준으로 위험이 낮고 접근이 쉬운 곳입니다. 시각은 지도의 시간 막대로 바꿉니다.`}
        time={time}
        baseTime={baseTime}
        center={center}
        alert={alert}
        onPick={onPick}
      />

      <section className="block" aria-labelledby="all-spots-title">
        <div className="sheet-body">
          <h2 id="all-spots-title" className="sheet-title">
            모든 포인트
          </h2>
          <p className="sheet-sub">위험 점수가 낮은 순서입니다. 누르면 지도에서 엽니다.</p>
          {spotsRes.status === 'loading' && <div className="skeleton skeleton--row" aria-busy="true" />}
          {spotsRes.status === 'error' && (
            <p className="state" role="alert">
              포인트를 불러오지 못했습니다.
            </p>
          )}
          {spotsRes.status === 'ready' && (
            <SpotList spots={spotsRes.data.spots} onPick={onPick} />
          )}
        </div>
      </section>
    </div>
  );
}
