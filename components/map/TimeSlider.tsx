'use client';

import type { CSSProperties } from 'react';
import { Icon } from '@/components/spot/RiskBadge';
import { addHoursIso, formatPlaceTime } from '@/lib/ui/time';

interface Props {
  index: number;
  max: number;
  baseTime: string;
  playing: boolean;
  /** 막대 전체에서 밤인 구간(0~1 비율). 막대 아래에 띠로 그린다 */
  nights: Array<[number, number]>;
  /** 고른 시각이 밤인지 */
  night: boolean;
  /** 다음에 해가 뜨거나 지는 시각. 예: "해 짐 16:40" */
  sunNote: string | null;
  onChange: (index: number) => void;
  onTogglePlay: () => void;
}

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

/** 밤 구간만 색을 칠한 가로 띠 */
function nightBand(nights: Array<[number, number]>): string | undefined {
  if (nights.length === 0) return undefined;
  const stops = nights.flatMap(([a, b]) => [
    `transparent ${pct(a)}`,
    `var(--sun-night) ${pct(a)}`,
    `var(--sun-night) ${pct(b)}`,
    `transparent ${pct(b)}`,
  ]);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

function SunIcon({ night }: { night: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden="true" focusable="false" className="timebar__sun">
      {night ? (
        <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z" fill="currentColor" />
      ) : (
        <>
          <circle cx="12" cy="12" r="4.5" fill="currentColor" />
          <path
            d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}

export default function TimeSlider({ index, max, baseTime, playing, nights, night, sunNote, onChange, onTogglePlay }: Props) {
  const label = formatPlaceTime(addHoursIso(baseTime, index), baseTime);
  const dayPart = night ? '밤' : '낮';
  return (
    <div className="timebar" role="group" aria-label="예보 시각 선택">
      <button
        type="button"
        className="icon-btn"
        onClick={onTogglePlay}
        aria-label={playing ? '시간 흐름 멈춤' : '시간 흐름 재생'}
        aria-pressed={playing}
      >
        <Icon name={playing ? 'pause' : 'play'} />
      </button>
      <div className="timebar__track">
        <div className="timebar__range">
          <input
            type="range"
            min={0}
            max={max}
            step={1}
            value={index}
            onChange={(e) => onChange(Number(e.target.value))}
            aria-label="예보 시각"
            aria-valuetext={`${label}, ${dayPart}, 지금부터 ${index}시간 뒤`}
            style={{ '--fill': `${(index / max) * 100}%` } as CSSProperties}
          />
          {/* 밤인 구간을 막대 아래에 짙은 띠로 보여 준다. 낮·밤은 오른쪽 글자로도 알려 주므로 꾸밈 요소다. */}
          <span className="timebar__nights" style={{ backgroundImage: nightBand(nights) }} aria-hidden="true" />
        </div>
        <div className="timebar__ticks" aria-hidden="true">
          <span>지금</span>
          <span>+24시간</span>
          <span>+48시간</span>
          <span>+72시간</span>
        </div>
      </div>
      <output className="timebar__now">
        <span className="timebar__when">
          <SunIcon night={night} />
          <span className="visually-hidden">{dayPart}, </span>
          {label}
        </span>
        <small>
          현지 시각{sunNote && ` · ${sunNote}`}
        </small>
      </output>
    </div>
  );
}
