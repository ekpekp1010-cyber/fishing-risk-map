'use client';

import { GradeIcon, Icon } from '@/components/spot/RiskBadge';
import type { SpotSummary, SpotType } from '@/lib/ui/api-types';
import { GRADE_LABEL, SPOT_TYPES, TYPE_LABEL } from '@/lib/ui/labels';

interface Props {
  spots: SpotSummary[];
  query: string;
  onQuery: (q: string) => void;
  types: SpotType[];
  onToggleType: (t: SpotType) => void;
  safeOnly: boolean;
  onToggleSafe: () => void;
  onPick: (spot: SpotSummary) => void;
}

export default function SearchFilters({ spots, query, onQuery, types, onToggleType, safeOnly, onToggleSafe, onPick }: Props) {
  const q = query.trim();
  const results = q ? spots.filter((s) => s.name.includes(q) || TYPE_LABEL[s.type].includes(q)).slice(0, 6) : [];
  return (
    <div className="search">
      <div className="searchbar">
        <Icon name="search" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="포인트 이름, 장소 유형 검색"
          aria-label="포인트 검색"
          aria-controls="search-results"
        />
        {query && (
          <button type="button" className="icon-btn icon-btn--small" aria-label="검색어 지우기" onClick={() => onQuery('')}>
            <Icon name="close" size={20} />
          </button>
        )}
      </div>
      {q && (
        <ul id="search-results" className="search__results" aria-label="검색 결과">
          {results.length === 0 && <li className="search__empty">일치하는 포인트가 없습니다.</li>}
          {results.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => onPick(s)}>
                <GradeIcon grade={s.grade} size={24} />
                <span>{s.name}</span>
                <small>
                  {TYPE_LABEL[s.type]} · {GRADE_LABEL[s.grade]}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="chips" role="group" aria-label="포인트 필터">
        {SPOT_TYPES.map((t) => (
          <button key={t} type="button" className="chip" aria-pressed={types.includes(t)} onClick={() => onToggleType(t)}>
            {TYPE_LABEL[t]}
          </button>
        ))}
        <button type="button" className="chip" aria-pressed={safeOnly} onClick={onToggleSafe}>
          안전만 보기
        </button>
      </div>
    </div>
  );
}
