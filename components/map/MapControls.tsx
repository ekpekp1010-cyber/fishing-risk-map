'use client';

import { useState } from 'react';
import { Icon } from '@/components/spot/RiskBadge';
import { MAP_CONFIG, type LayerState } from '@/lib/map/config';

interface Props {
  mode: '2d' | '3d';
  onMode: (mode: '2d' | '3d') => void;
  layers: LayerState;
  onLayers: (layers: LayerState) => void;
  onLocate: () => void;
}

const LAYER_ITEMS: Array<{ key: keyof LayerState; label: string; available: boolean; note?: string }> = [
  { key: 'zones', label: '위험 구역', available: true },
  { key: 'relief', label: '지형 음영(경사)', available: true },
  { key: 'flood', label: '과거 침수 흔적', available: MAP_CONFIG.floodTiles !== null, note: '데이터 준비 중' },
  { key: 'satellite', label: '위성 영상', available: MAP_CONFIG.satelliteTiles !== null, note: '데이터 준비 중' },
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
              <label key={item.key} className={item.available ? undefined : 'is-disabled'}>
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
