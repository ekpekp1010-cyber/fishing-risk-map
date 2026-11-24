'use client';

import { Fragment, useState } from 'react';
import { Icon } from '@/components/spot/RiskBadge';
import { MAP_CONFIG, type LayerState } from '@/lib/map/config';

interface Props {
  mode: '2d' | '3d';
  onMode: (mode: '2d' | '3d') => void;
  layers: LayerState;
  onLayers: (layers: LayerState) => void;
  onLocate: () => void;
}

const LAYER_ITEMS: Array<{ key: keyof LayerState; label: string; available: boolean; note?: string; group?: string }> = [
  { key: 'wind', label: '바람 흐름', available: true, group: '실시간' },
  { key: 'waves', label: '파고', available: true },
  { key: 'radar', label: '강수 레이더(미국)', available: true },
  { key: 'clouds', label: '위성 구름 영상', available: true },
  { key: 'currents', label: '표층 해류', available: true, group: '시간별 예보' },
  { key: 'zones', label: '위험 구역', available: true, group: '지도' },
  { key: 'relief', label: '지형 음영(경사)', available: true },
  { key: 'flood', label: '과거 침수 흔적', available: MAP_CONFIG.floodTiles !== null, note: '데이터 준비 중' },
  { key: 'satellite', label: '항공·위성 사진', available: true },
];

export default function MapControls({ mode, onMode, layers, onLayers, onLocate }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="controls">
      <div className="segmented" role="group" aria-label="지도 보기 방식">
        {(['2d', '3d'] as const).map((m) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => onMode(m)}>
            {m.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="controls__layers">
        <button
          type="button"
          className="icon-btn icon-btn--surface"
          aria-label="레이어 선택"
          aria-expanded={open}
          aria-controls={open ? 'layer-menu' : undefined}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name="layers" />
        </button>
        {open && (
          <fieldset id="layer-menu" className="popover">
            <legend>레이어</legend>
            {LAYER_ITEMS.map((item) => (
              <Fragment key={item.key}>
                {item.group && <p className="popover__group">{item.group}</p>}
                <label className={item.available ? undefined : 'is-disabled'}>
                  <input
                    type="checkbox"
                    checked={layers[item.key]}
                    disabled={!item.available}
                    onChange={(e) => onLayers({ ...layers, [item.key]: e.target.checked })}
                  />
                  <span>
                    {item.label}
                    {!item.available && item.note && <small> · {item.note}</small>}
                  </span>
                </label>
              </Fragment>
            ))}
          </fieldset>
        )}
      </div>
      <button type="button" className="icon-btn icon-btn--fab" aria-label="내 위치로 이동" onClick={onLocate}>
        <Icon name="locate" />
      </button>
    </div>
  );
}
