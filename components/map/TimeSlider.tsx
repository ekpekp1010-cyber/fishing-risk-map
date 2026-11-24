'use client';

import type { CSSProperties } from 'react';
import { Icon } from '@/components/spot/RiskBadge';
import { addHoursIso, formatPlaceTime } from '@/lib/ui/time';

interface Props {
  index: number;
  max: number;
  baseTime: string;
  playing: boolean;
  onChange: (index: number) => void;
  onTogglePlay: () => void;
}

export default function TimeSlider({ index, max, baseTime, playing, onChange, onTogglePlay }: Props) {
  const label = formatPlaceTime(addHoursIso(baseTime, index), baseTime);
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
        <input
          type="range"
          min={0}
          max={max}
          step={1}
          value={index}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label="예보 시각"
          aria-valuetext={`${label}, 지금부터 ${index}시간 뒤`}
          style={{ '--fill': `${(index / max) * 100}%` } as CSSProperties}
        />
        <div className="timebar__ticks" aria-hidden="true">
          <span>지금</span>
          <span>+24시간</span>
          <span>+48시간</span>
          <span>+72시간</span>
        </div>
      </div>
      <output className="timebar__now">
        {label}
        <small>현지 시각</small>
      </output>
    </div>
  );
}
