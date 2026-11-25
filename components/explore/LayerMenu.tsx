'use client';

// 지도 위에 겹쳐 볼 것을 고르는 메뉴. 레이어 버튼을 누르면 버튼 아래로 펼쳐진다.
// 3D(실사) 지도에서는 위험 구역만 켜고 끌 수 있고, 나머지는 2D 지도에서 볼 수 있다고 알린다.

import { Fragment, useEffect, useRef, useState } from 'react';
import { ExIcon } from './icons';
import { MAP_CONFIG, type LayerState } from '@/lib/map/config';

interface Item {
  key: keyof LayerState;
  label: string;
  group?: string;
  /** false면 고를 수 없다(데이터 준비 중) */
  available?: boolean;
  note?: string;
  /** 3D 지도에서도 보이는지 */
  in3d?: boolean;
}

const ITEMS: Item[] = [
  { key: 'wind', label: '바람 흐름', group: '실시간' },
  { key: 'waves', label: '파도 높이' },
  { key: 'temp', label: '기온' },
  { key: 'radar', label: '비구름 레이더(미국)' },
  { key: 'clouds', label: '위성 구름 사진' },
  { key: 'currents', label: '바닷물 흐름(해류)', group: '예보' },
  { key: 'zones', label: '위험 구역', group: '지도', in3d: true },
  { key: 'relief', label: '땅 높낮이(경사)' },
  { key: 'flood', label: '과거 침수 흔적', available: MAP_CONFIG.floodTiles !== null, note: '데이터 준비 중' },
  { key: 'satellite', label: '위성 사진' },
];

interface Props {
  layers: LayerState;
  onChange: (layers: LayerState) => void;
  mode: '2d' | '3d';
}

export default function LayerMenu({ layers, onChange, mode }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 메뉴 밖을 누르거나 Esc를 누르면 닫는다.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="ex-layers" ref={rootRef}>
      <button
        type="button"
        className="ex-fab"
        aria-label="레이어 고르기"
        aria-expanded={open}
        aria-controls={open ? 'ex-layer-menu' : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <ExIcon name="layers" />
      </button>
      {open && (
        <fieldset id="ex-layer-menu" className="ex-layer-menu">
          <legend>레이어</legend>
          {ITEMS.map((item) => {
            const only2d = mode === '3d' && !item.in3d;
            const disabled = item.available === false || only2d;
            const note = item.available === false ? item.note : only2d ? '2D에서 볼 수 있어요' : null;
            return (
              <Fragment key={item.key}>
                {item.group && <p className="ex-layer-menu__group">{item.group}</p>}
                <label className={disabled ? 'is-disabled' : undefined}>
                  <input
                    type="checkbox"
                    checked={layers[item.key] && !disabled}
                    disabled={disabled}
                    onChange={(e) => onChange({ ...layers, [item.key]: e.target.checked })}
                  />
                  <span>
                    {item.label}
                    {note && <small>{note}</small>}
                  </span>
                </label>
              </Fragment>
            );
          })}
        </fieldset>
      )}
    </div>
  );
}
