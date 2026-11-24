import type { Metadata } from 'next';
import { GradeIcon } from '@/components/spot/RiskBadge';
import { SAFETY_NOTICE } from '@/lib/ui/labels';

export const metadata: Metadata = { title: '설정과 출처 · 낚시 포인트 위험도 지도' };

const SOURCES: Array<{ name: string; use: string; href: string; credit: string }> = [
  { name: 'Open-Meteo', use: '기상·파랑·해수면·하천 유량 예보', href: 'https://open-meteo.com/', credit: 'Weather data by Open-Meteo.com (CC BY 4.0)' },
  { name: 'Copernicus DEM GLO-30', use: '고도, 경사', href: 'https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM', credit: '© DLR e.V. 2010-2014, © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA' },
  { name: 'Copernicus Sentinel-2', use: '수변 경계, 식생', href: 'https://dataspace.copernicus.eu/', credit: 'Contains modified Copernicus Sentinel data' },
  { name: 'JRC Global Surface Water', use: '과거 침수 흔적', href: 'https://global-surface-water.appspot.com/', credit: 'Source: EC JRC/Google' },
  { name: 'ESA WorldCover', use: '지표 피복', href: 'https://esa-worldcover.org/', credit: '© ESA WorldCover project (CC BY 4.0)' },
  { name: 'GEBCO', use: '근해 수심', href: 'https://www.gebco.net/', credit: 'GEBCO Compilation Group, GEBCO Grid' },
  { name: 'NOAA CO-OPS · NWS', use: '실측 수위, 기상 경보', href: 'https://tidesandcurrents.noaa.gov/', credit: 'NOAA / National Weather Service' },
  { name: 'OpenStreetMap', use: '배경 지도, 접근로', href: 'https://www.openstreetmap.org/copyright', credit: '© OpenStreetMap contributors' },
  { name: 'USGS The National Map', use: '지형 위에 입히는 항공 사진(미국)', href: 'https://www.usgs.gov/programs/national-geospatial-program/national-map', credit: 'USDA, USGS The National Map: Orthoimagery' },
  { name: 'Mapzen Terrain Tiles', use: '개발 단계의 3D 지형', href: 'https://registry.opendata.aws/terrain-tiles/', credit: 'Terrain Tiles hosted on AWS Open Data' },
];

export default function SettingsPage() {
  return (
    <div className="page">
      <h1 className="page__title">설정과 출처</h1>

      <section className="card">
        <div className="sheet-body">
          <h2 className="sheet-title">안전 고지</h2>
          <p>{SAFETY_NOTICE}</p>
          <p>‘안전’ 등급은 위험이 없다는 뜻이 아니라 계산된 위험이 낮다는 뜻입니다. 출발 전과 현장에서 공식 기상·해양 경보를 먼저 확인하세요.</p>
        </div>
      </section>

      <section className="card">
        <div className="sheet-body">
          <h2 className="sheet-title">등급 읽는 법</h2>
          <ul className="grade-guide">
            <li>
              <GradeIcon grade="safe" size={32} />
              <span>
                <strong>안전</strong> 위험 점수 0~39. 원 모양.
              </span>
            </li>
            <li>
              <GradeIcon grade="caution" size={32} />
              <span>
                <strong>주의</strong> 위험 점수 40~69. 삼각형 모양.
              </span>
            </li>
            <li>
              <GradeIcon grade="danger" size={32} />
              <span>
                <strong>위험</strong> 위험 점수 70~100 또는 공식 경보 발효 중. 팔각형 모양.
              </span>
            </li>
          </ul>
          <p className="meta">등급은 색, 모양, 글자 세 가지로 함께 표시합니다. 시각은 모두 시범 지역의 현지 시각입니다.</p>
        </div>
      </section>

      <section className="card">
        <div className="sheet-body">
          <h2 className="sheet-title">데이터 출처</h2>
          <p className="sheet-sub">현재 화면의 점수와 좌표는 개발용 예시 데이터일 수 있습니다.</p>
          <ul className="sources">
            {SOURCES.map((s) => (
              <li key={s.name}>
                <a href={s.href} target="_blank" rel="noreferrer">
                  {s.name}
                </a>
                <span>{s.use}</span>
                <small>{s.credit}</small>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
