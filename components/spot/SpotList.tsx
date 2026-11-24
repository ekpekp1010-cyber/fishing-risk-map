import type { SpotSummary } from '@/lib/contract/types';
import { GRADE_LABEL, TYPE_LABEL } from '@/lib/ui/labels';
import { GradeIcon } from './RiskBadge';

export default function SpotList({ spots, onPick }: { spots: SpotSummary[]; onPick: (spot: SpotSummary) => void }) {
  return (
    <div>
      <div className="spot-columns meta" aria-hidden="true">
        <span>이름 · 유형</span><span>등급</span><span>점수</span>
      </div>
      <ol className="list" aria-label="위험 점수가 낮은 순서">
        {[...spots].sort((a, b) => a.score - b.score).map((spot) => (
          <li key={spot.id}>
            <button type="button" className="spot-columns spot-row" onClick={() => onPick(spot)}>
              <span className="list-item__text">
                <strong>{spot.name}</strong>
                <small>{TYPE_LABEL[spot.type]}</small>
              </span>
              <span className="spot-row__grade"><GradeIcon grade={spot.grade} size={18} />{GRADE_LABEL[spot.grade]}</span>
              <strong className="spot-row__score"><span className="visually-hidden">위험 점수 </span>{spot.score}</strong>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
