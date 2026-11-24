-- 예보 자동 수집: Supabase 안에서 pg_cron + pg_net으로 매시간 돌린다(Vercel 유료 요금제 없이).
-- lib/server/open-meteo.ts, lib/server/nws.ts와 같은 규칙이다. 한쪽을 바꾸면 다른 쪽도 함께 고친다.
--   매시 05분  forecast_request(): Open-Meteo Marine·Forecast·Flood, NWS 경보를 비동기로 요청
--   매시 07·15분 forecast_ingest(): 도착한 응답을 forecast_hourly·alerts에 반영
--   매일 03:30  오래된 예보·요청 기록 정리

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create table public.collector_requests (
  request_id bigint primary key,            -- net.http_get이 돌려준 id
  kind text not null check (kind in ('marine', 'forecast', 'flood', 'nws')),
  cell_ids text[] not null default '{}',    -- 응답 배열의 순서와 같은 셀 id
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  result text
);
alter table public.collector_requests enable row level security;
grant select, insert, update, delete on public.collector_requests to service_role;

-- NWS 경보 이름 → 화면용 한국어 문장(lib/server/nws.ts EVENT_KO와 같다)
create table public.alert_event_ko (
  event text primary key,
  headline text not null
);
alter table public.alert_event_ko enable row level security;
grant select on public.alert_event_ko to service_role;
insert into public.alert_event_ko (event, headline) values
  ('High Surf Advisory', '높은 파도 주의보 발효 중'),
  ('High Surf Warning', '높은 파도 경보 발효 중'),
  ('Beach Hazards Statement', '해변 위험 정보 발표 중'),
  ('Coastal Flood Advisory', '해안 침수 주의보 발효 중'),
  ('Coastal Flood Warning', '해안 침수 경보 발효 중'),
  ('Coastal Flood Watch', '해안 침수 감시 발효 중'),
  ('Small Craft Advisory', '소형 선박 주의보 발효 중'),
  ('Gale Warning', '강풍 경보(해상) 발효 중'),
  ('Storm Warning', '폭풍 경보(해상) 발효 중'),
  ('Hurricane Force Wind Warning', '허리케인급 강풍 경보 발효 중'),
  ('Wind Advisory', '강풍 주의보 발효 중'),
  ('High Wind Warning', '강풍 경보 발효 중'),
  ('Flood Watch', '홍수 감시 발효 중'),
  ('Flood Warning', '홍수 경보 발효 중'),
  ('Flash Flood Warning', '돌발 홍수 경보 발효 중'),
  ('Severe Thunderstorm Warning', '강한 뇌우 경보 발효 중'),
  ('Tsunami Warning', '지진해일 경보 발효 중'),
  ('Tsunami Advisory', '지진해일 주의보 발효 중'),
  ('Tsunami Watch', '지진해일 감시 발효 중'),
  ('Winter Storm Warning', '겨울 폭풍 경보 발효 중'),
  ('Dense Fog Advisory', '짙은 안개 주의보 발효 중')
on conflict (event) do update set headline = excluded.headline;

-- ---- 요청 ---------------------------------------------------------------------------

create or replace function public.forecast_request() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  ids text[];
  lats text;
  lngs text;
  common jsonb;
begin
  select array_agg(id order by id),
         string_agg(to_char(lat, 'FM990.00'), ',' order by id),
         string_agg(to_char(lng, 'FM9990.00'), ',' order by id)
    into ids, lats, lngs
    from public.forecast_cells;
  if ids is null then
    return 0;
  end if;
  common := jsonb_build_object('latitude', lats, 'longitude', lngs, 'timezone', 'UTC', 'forecast_days', '4');

  insert into public.collector_requests (request_id, kind, cell_ids) values
    (net.http_get(
       'https://marine-api.open-meteo.com/v1/marine',
       params := common || jsonb_build_object('hourly',
         'wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_period,swell_wave_direction,sea_level_height_msl'),
       timeout_milliseconds := 30000), 'marine', ids),
    (net.http_get(
       'https://api.open-meteo.com/v1/forecast',
       params := common || jsonb_build_object('wind_speed_unit', 'ms', 'hourly',
         'wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation,weather_code,apparent_temperature,is_day'),
       timeout_milliseconds := 30000), 'forecast', ids),
    (net.http_get(
       'https://flood-api.open-meteo.com/v1/flood',
       params := jsonb_build_object('latitude', lats, 'longitude', lngs, 'daily', 'river_discharge',
                                    'past_days', '30', 'forecast_days', '4'),
       timeout_milliseconds := 30000), 'flood', ids),
    (net.http_get(
       'https://api.weather.gov/alerts/active',
       params := jsonb_build_object('point', '44.6250,-124.0450'),  -- NOAA 9435380 South Beach
       headers := jsonb_build_object(
         'User-Agent', 'fishing-risk-map (https://github.com/ekpekp1010-cyber/fishing-risk-map)',
         'Accept', 'application/geo+json'),
       timeout_milliseconds := 30000), 'nws', '{}');
  return 4;
end;
$$;

-- ---- 반영 ---------------------------------------------------------------------------

create or replace function public.forecast_ingest() returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  body jsonb;
  items jsonb;
  it jsonb;
  i integer;
  cell text;
  today date;
  base double precision;
  keep_ids text[];
  done integer := 0;
  failed integer := 0;
begin
  for r in
    select q.request_id, q.kind, q.cell_ids, q.requested_at,
           h.status_code, h.content, h.timed_out, h.error_msg
      from public.collector_requests q
      join net._http_response h on h.id = q.request_id
     where q.processed_at is null
     order by q.request_id
  loop
    if r.status_code is distinct from 200 then
      update public.collector_requests
         set processed_at = now(),
             result = coalesce('HTTP ' || r.status_code, r.error_msg, case when r.timed_out then 'timeout' end, 'error')
       where request_id = r.request_id;
      failed := failed + 1;
      continue;
    end if;

    body := r.content::jsonb;

    if r.kind = 'nws' then
      -- 테스트 메시지·취소는 뺀다. 만료는 ends가 있으면 ends.
      with f as (
        select x -> 'properties' as p
          from jsonb_array_elements(coalesce(body -> 'features', '[]'::jsonb)) as x
         where coalesce(x -> 'properties' ->> 'status', '') <> 'Test'
           and coalesce(x -> 'properties' ->> 'messageType', '') <> 'Cancel'
      ), up as (
        insert into public.alerts (id, source, event, headline, severity, onset, expires, fetched_at)
        select p ->> 'id', 'NWS', p ->> 'event',
               coalesce((select k.headline from public.alert_event_ko k where k.event = p ->> 'event'), (p ->> 'event') || ' 발효 중'),
               p ->> 'severity',
               coalesce(p ->> 'onset', p ->> 'effective')::timestamptz,
               coalesce(p ->> 'ends', p ->> 'expires')::timestamptz,
               r.requested_at
          from f
        on conflict (id) do update
          set event = excluded.event, headline = excluded.headline, severity = excluded.severity,
              onset = excluded.onset, expires = excluded.expires, fetched_at = excluded.fetched_at
        returning id
      )
      select coalesce(array_agg(id), '{}') into keep_ids from up;
      delete from public.alerts where source = 'NWS' and not (id = any (keep_ids));
    else
      items := case when jsonb_typeof(body) = 'array' then body else jsonb_build_array(body) end;
      for i in 0 .. jsonb_array_length(items) - 1 loop
        it := items -> i;
        cell := r.cell_ids[i + 1];
        continue when cell is null;

        if r.kind = 'marine' then
          insert into public.forecast_hourly (
            cell_id, time, wave_height_m, wave_direction_deg, wave_period_s,
            swell_height_m, swell_period_s, swell_direction_deg, sea_level_m, fetched_at)
          select cell, (t || ':00Z')::timestamptz,
                 (it -> 'hourly' -> 'wave_height' ->> (o::int - 1))::real,
                 (it -> 'hourly' -> 'wave_direction' ->> (o::int - 1))::real,
                 (it -> 'hourly' -> 'wave_period' ->> (o::int - 1))::real,
                 (it -> 'hourly' -> 'swell_wave_height' ->> (o::int - 1))::real,
                 (it -> 'hourly' -> 'swell_wave_period' ->> (o::int - 1))::real,
                 (it -> 'hourly' -> 'swell_wave_direction' ->> (o::int - 1))::real,
                 (it -> 'hourly' -> 'sea_level_height_msl' ->> (o::int - 1))::real,
                 r.requested_at
            from jsonb_array_elements_text(it -> 'hourly' -> 'time') with ordinality as x(t, o)
          on conflict (cell_id, time) do update
            set wave_height_m = excluded.wave_height_m, wave_direction_deg = excluded.wave_direction_deg,
                wave_period_s = excluded.wave_period_s, swell_height_m = excluded.swell_height_m,
                swell_period_s = excluded.swell_period_s, swell_direction_deg = excluded.swell_direction_deg,
                sea_level_m = excluded.sea_level_m, fetched_at = excluded.fetched_at;

        elsif r.kind = 'forecast' then
          insert into public.forecast_hourly (
            cell_id, time, wind_speed_ms, wind_gust_ms, wind_direction_deg, precipitation_mm,
            weather_code, apparent_temp_c, is_dark, fetched_at)
          select cell, (t || ':00Z')::timestamptz,
                 (it -> 'hourly' -> 'wind_speed_10m' ->> (o::int - 1))::real,
                 (it -> 'hourly' -> 'wind_gusts_10m' ->> (o::int - 1))::real,
                 (it -> 'hourly' -> 'wind_direction_10m' ->> (o::int - 1))::real,
                 (it -> 'hourly' -> 'precipitation' ->> (o::int - 1))::real,
                 (it -> 'hourly' -> 'weather_code' ->> (o::int - 1))::numeric::smallint,
                 (it -> 'hourly' -> 'apparent_temperature' ->> (o::int - 1))::real,
                 ((it -> 'hourly' -> 'is_day' ->> (o::int - 1))::numeric = 0),
                 r.requested_at
            from jsonb_array_elements_text(it -> 'hourly' -> 'time') with ordinality as x(t, o)
          on conflict (cell_id, time) do update
            set wind_speed_ms = excluded.wind_speed_ms, wind_gust_ms = excluded.wind_gust_ms,
                wind_direction_deg = excluded.wind_direction_deg, precipitation_mm = excluded.precipitation_mm,
                weather_code = excluded.weather_code, apparent_temp_c = excluded.apparent_temp_c,
                is_dark = excluded.is_dark, fetched_at = excluded.fetched_at;

        elsif r.kind = 'flood' then
          -- 하천 유량 비 = 그날 유량 / 수집일 이전 날들의 중앙값
          today := (r.requested_at at time zone 'UTC')::date;
          select percentile_cont(0.5) within group (order by v)
            into base
            from (
              select (it -> 'daily' -> 'river_discharge' ->> (o::int - 1))::double precision as v
                from jsonb_array_elements_text(it -> 'daily' -> 'time') with ordinality as x(d, o)
               where d::date < today
            ) past
           where v is not null;
          update public.forecast_hourly h
             set river_discharge_m3s = d.v,
                 river_ratio = case when base > 0 then d.v / base end
            from (
              select x.d::date as day, (it -> 'daily' -> 'river_discharge' ->> (o::int - 1))::double precision as v
                from jsonb_array_elements_text(it -> 'daily' -> 'time') with ordinality as x(d, o)
            ) d
           where h.cell_id = cell and (h.time at time zone 'UTC')::date = d.day;
        end if;
      end loop;
    end if;

    update public.collector_requests set processed_at = now(), result = 'ok' where request_id = r.request_id;
    done := done + 1;
  end loop;
  return format('ok %s, failed %s', done, failed);
end;
$$;

-- PostgREST가 public 함수를 RPC로 열지 않도록 실행 권한을 막는다(cron은 postgres로 돈다).
revoke execute on function public.forecast_request() from public, anon, authenticated;
revoke execute on function public.forecast_ingest() from public, anon, authenticated;

-- ---- 일정 ---------------------------------------------------------------------------

select cron.schedule('forecast-request', '5 * * * *', 'select public.forecast_request()');
select cron.schedule('forecast-ingest', '7,15 * * * *', 'select public.forecast_ingest()');
select cron.schedule(
  'forecast-cleanup', '30 3 * * *',
  $$delete from public.forecast_hourly where time < now() - interval '2 days';
    delete from public.collector_requests where requested_at < now() - interval '2 days';$$
);
