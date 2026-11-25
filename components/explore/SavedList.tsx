'use client';

// 저장 탭: 내가 저장한 낚시 포인트만 보여 준다(최신순).
// 줄마다 별 아이콘(지금 상태 색), 이름, 종류와 지금 상태, 저장 해제 버튼이 있다.

import { ExIcon } from './icons';
import type { Grade, SpotSummary } from '@/lib/contract/types';
import { GRADE_SHORT, TYPE_PLAIN } from '@/lib/ui/plain';
import { useSavedSpots, type SavedSpot } from '@/lib/ui/saved';

interface Props {
  /** 선택한 시간의 포인트 상태. 저장한 곳의 지금 색을 고르는 데 쓴다 */
  spots: SpotSummary[];
  timeLabel: string;
  onPick: (spot: SavedSpot) => void;
}

export default function SavedList({ spots, timeLabel, onPick }: Props) {
  const { list, remove } = useSavedSpots();
  const gradeOf = (id: string): Grade | null => spots.find((s) => s.id === id)?.grade ?? null;

  return (
    <div className="ex-card">
      <header className="ex-saved-head">
        <h2 className="ex-card__title">저장한 곳</h2>
        <span className="ex-count-chip">전체 {list.length}</span>
      </header>

      {list.length === 0 ? (
        <div className="ex-saved-empty">
          <span className="ex-saved-empty__icon">
            <ExIcon name="star" size={28} />
          </span>
          <p>아직 저장한 곳이 없어요.</p>
          <p className="ex-note">지도에서 낚시할 곳을 누르고 ☆ 저장을 눌러 보세요.</p>
        </div>
      ) : (
        <ul className="ex-list ex-saved-list">
          {list.map((s) => {
            const grade = gradeOf(s.id);
            return (
              <li key={s.id} className="ex-saved-row">
                <button type="button" className="ex-row" onClick={() => onPick(s)}>
                  <span className={`ex-saved-badge ex-saved-badge--${grade ?? 'none'}`} aria-hidden="true">
                    <ExIcon name="star" size={20} filled />
                  </span>
                  <span className="ex-row__text">
                    <span className="ex-row__title">{s.name}</span>
                    <span className="ex-row__meta">
                      {TYPE_PLAIN[s.type]}
                      {grade && (
                        <>
                          {' · '}
                          {timeLabel} <b className={`ex-grade-text ex-grade-text--${grade}`}>{GRADE_SHORT[grade]}</b>
                        </>
                      )}
                    </span>
                  </span>
                </button>
                <button type="button" className="ex-icon-btn ex-star ex-star--on" aria-label={`${s.name} 저장 취소`} onClick={() => remove(s.id)}>
                  <ExIcon name="star" size={22} filled />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
