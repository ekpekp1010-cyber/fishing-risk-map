-- 0단계 스키마 초안: 포인트, 지형 점수, 위험 구역, 예보 격자, 시간별 예보, 경보.
-- 좌표는 모두 WGS84(EPSG:4326). 시각은 timestamptz(UTC).
-- 모든 테이블은 RLS를 켜고 정책을 두지 않는다. 읽기·쓰기는 서버(Route Handler, 파이프라인)가
-- service role 키로만 한다. 브라우저에 직접 열 테이블이 생기면 그때 읽기 정책을 추가한다.

-- Supabase 권장대로 extensions 스키마에 둔다(기본 search_path에 포함된다).
create extension if not exists postgis with schema extensions;

-- 예보 격자 셀: 0.05° 단위. id 예: "44.60_-124.05"
create table public.forecast_cells (
  id text primary key,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  geom geometry(Point, 4326) generated always as (st_setsrid(st_makepoint(lng, lat), 4326)) stored,
  created_at timestamptz not null default now()
);

-- 낚시 포인트
create table public.spots (
  id text primary key,                         -- 예: "newport-south-jetty-01"
  name text not null,                          -- 한국어 표시 이름
  type text not null check (type in ('jetty', 'pier', 'rocks', 'beach', 'estuary')),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  geom geometry(Point, 4326) generated always as (st_setsrid(st_makepoint(lng, lat), 4326)) stored,
  access_walk_minutes integer check (access_walk_minutes >= 0),
  access_from text,                            -- 예: "사우스 제티 주차장"
  forecast_cell_id text references public.forecast_cells (id),
  active boolean not null default true,        -- 검수 전·낚시 금지 확인 전에는 false
  source text,                                 -- 예: "osm:way/123456" 또는 "manual"
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index spots_geom_idx on public.spots using gist (geom);

-- 지형 취약성 V (포인트당 최신 1행)
create table public.terrain_scores (
  spot_id text primary key references public.spots (id) on delete cascade,
  score smallint not null check (score between 0 and 100),
  slope_deg real,
  elevation_m real,                            -- 평균해면 대비
  water_distance_m real,                       -- 수변 경계까지 거리
  cover text,                                  -- 화면용 한국어 피복 이름. 예: "암반"
  flood_frequency text check (flood_frequency in ('high', 'medium', 'low')),
  wave_exposure_deg real,                      -- 외해를 향한 방향(도)
  egress_distance_m real,                      -- 도로·주차장까지 거리
  egress_rise_m real,                          -- 퇴로까지 고도차
  factors jsonb not null default '[]'::jsonb,  -- [{code, label, score, weight, contribution}]
  confidence text not null default 'low' check (confidence in ('high', 'medium', 'low')),
  data_vintage jsonb not null default '{}'::jsonb, -- 데이터셋별 제작 연도. 예: {"copdem": 2021}
  computed_at timestamptz not null default now()
);

-- 위험 구역 (PMTiles 레이어 "zones"와 같은 zoneId)
create table public.zones (
  id text primary key,                         -- 예: "zone-0012"
  spot_id text references public.spots (id) on delete set null,
  geom geometry(MultiPolygon, 4326) not null,
  terrain_score smallint check (terrain_score between 0 and 100),
  forecast_cell_id text references public.forecast_cells (id),
  created_at timestamptz not null default now()
);
create index zones_geom_idx on public.zones using gist (geom);
create index zones_spot_idx on public.zones (spot_id);

-- 시간별 예보 (Open-Meteo Forecast·Marine·Flood를 셀 단위로 합친 것)
create table public.forecast_hourly (
  cell_id text not null references public.forecast_cells (id) on delete cascade,
  time timestamptz not null,                   -- 정시
  wave_height_m real,
  wave_period_s real,
  wave_direction_deg real,
  swell_height_m real,
  swell_period_s real,
  swell_direction_deg real,
  wind_speed_ms real,
  wind_gust_ms real,
  wind_direction_deg real,
  precipitation_mm real,
  weather_code smallint,                       -- WMO 코드. 95~99는 뇌우
  sea_level_m real,                            -- Open-Meteo 해수면 높이(평균해면 기준)
  sea_level_corrected_m real,                  -- NOAA 9435380 실측으로 보정한 값
  river_discharge_m3s real,
  raw jsonb,                                   -- 원본 값(디버깅·재계산용)
  fetched_at timestamptz not null,             -- 수집 시각. stale 판정에 쓴다
  primary key (cell_id, time)
);
create index forecast_hourly_time_idx on public.forecast_hourly (time);

-- NWS 경보
create table public.alerts (
  id text primary key,                         -- NWS 경보 id
  source text not null default 'NWS',
  event text not null,                         -- 예: "High Surf Advisory"
  headline text,                               -- 화면용 한국어 문장
  severity text,
  onset timestamptz,
  expires timestamptz,
  area geometry(MultiPolygon, 4326),           -- 없으면 지역 전체로 본다
  fetched_at timestamptz not null default now()
);
create index alerts_expires_idx on public.alerts (expires);
create index alerts_area_idx on public.alerts using gist (area);

-- updated_at 자동 갱신
create function public.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger spots_touch_updated_at
  before update on public.spots
  for each row execute function public.touch_updated_at();

alter table public.forecast_cells enable row level security;
alter table public.spots enable row level security;
alter table public.terrain_scores enable row level security;
alter table public.zones enable row level security;
alter table public.forecast_hourly enable row level security;
alter table public.alerts enable row level security;
