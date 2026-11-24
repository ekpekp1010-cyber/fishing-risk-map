-- NOAA 9435380 South Beach 실측으로 해수면 예보 보정(lib/server/noaa.ts와 같은 규칙).
--   보정값 = 실측이 있으면 실측, 없으면 천문조 예측 + 해일 성분 × exp(-Δt / 48시간)
--   해일 성분 = 최근 실측 3시간의 (실측 - 천문조) 평균. 실측이 3시간 넘게 끊기면 보정하지 않는다(null).
-- 20261124030000_forecast_collector.sql의 함수 두 개를 바꾼다.

create table public.tide_station_hourly (
  time timestamptz primary key,           -- 정시(UTC)
  predicted_m real,                       -- 천문조 예측(평균해면 기준)
  observed_m real,                        -- 실측(정각 값)
  updated_at timestamptz not null default now()
);
alter table public.tide_station_hourly enable row level security;
grant select, insert, update, delete on public.tide_station_hourly to service_role;

create table public.tide_corrections (
  computed_at timestamptz primary key default now(),
  last_observed timestamptz,
  surge_m real,                           -- null이면 관측 지연으로 보정하지 않음
  hours integer
);
alter table public.tide_corrections enable row level security;
grant select, insert, update, delete on public.tide_corrections to service_role;

alter table public.collector_requests drop constraint collector_requests_kind_check;
alter table public.collector_requests add constraint collector_requests_kind_check
  check (kind in ('marine', 'forecast', 'flood', 'nws', 'noaa_obs', 'noaa_pred'));

-- ---- 요청: NOAA 두 건 추가 ----------------------------------------------------------

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
  noaa jsonb := jsonb_build_object('station', '9435380', 'datum', 'MSL', 'units', 'metric',
                                   'time_zone', 'gmt', 'format', 'json', 'application', 'fishing-risk-map');
  noaa_url text := 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
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
       timeout_milliseconds := 30000), 'nws', '{}'),
    (net.http_get(noaa_url,
       params := noaa || jsonb_build_object('product', 'water_level', 'range', '24'),
       timeout_milliseconds := 30000), 'noaa_obs', '{}'),
    (net.http_get(noaa_url,
       params := noaa || jsonb_build_object('product', 'predictions', 'interval', 'h',
                                            'begin_date', to_char(now() at time zone 'UTC' - interval '1 day', 'YYYYMMDD'),
                                            'range', '144'),
       timeout_milliseconds := 30000), 'noaa_pred', '{}');
  return 6;
end;
$$;

-- ---- 반영: NOAA 처리와 해수면 보정 추가 ------------------------------------------------

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
  last_obs timestamptz;
  surge double precision;
  surge_hours integer;
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

    elsif r.kind = 'noaa_obs' then
      -- 6분 간격 실측 중 정각 값만
      insert into public.tide_station_hourly (time, observed_m, updated_at)
      select (replace(o ->> 't', ' ', 'T') || ':00Z')::timestamptz, (o ->> 'v')::real, now()
        from jsonb_array_elements(coalesce(body -> 'data', '[]'::jsonb)) as o
       where (o ->> 't') like '%:00' and coalesce(o ->> 'v', '') <> ''
      on conflict (time) do update set observed_m = excluded.observed_m, updated_at = excluded.updated_at;

    elsif r.kind = 'noaa_pred' then
      insert into public.tide_station_hourly (time, predicted_m, updated_at)
      select (replace(p ->> 't', ' ', 'T') || ':00Z')::timestamptz, (p ->> 'v')::real, now()
        from jsonb_array_elements(coalesce(body -> 'predictions', '[]'::jsonb)) as p
       where coalesce(p ->> 'v', '') <> ''
      on conflict (time) do update set predicted_m = excluded.predicted_m, updated_at = excluded.updated_at;

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

  -- ---- 해수면 보정 ----
  select max(time) into last_obs
    from public.tide_station_hourly
   where observed_m is not null and predicted_m is not null;

  if last_obs is not null and now() - last_obs <= interval '3 hours' then
    select avg(observed_m - predicted_m), count(*)
      into surge, surge_hours
      from public.tide_station_hourly
     where observed_m is not null and predicted_m is not null
       and time >= last_obs - interval '2 hours';

    update public.forecast_hourly h
       set sea_level_corrected_m = coalesce(
             s.observed_m,
             s.predicted_m + surge * exp(-greatest(0, extract(epoch from (h.time - last_obs)) / 3600.0) / 48.0))
      from public.tide_station_hourly s
     where s.time = h.time;
    update public.forecast_hourly h
       set sea_level_corrected_m = null
     where h.sea_level_corrected_m is not null
       and not exists (select 1 from public.tide_station_hourly s where s.time = h.time);
  else
    surge := null;
    update public.forecast_hourly set sea_level_corrected_m = null where sea_level_corrected_m is not null;
  end if;
  insert into public.tide_corrections (computed_at, last_observed, surge_m, hours)
  values (now(), last_obs, surge, surge_hours)
  on conflict (computed_at) do nothing;

  return format('ok %s, failed %s, surge %s', done, failed, coalesce(round(surge::numeric, 3)::text, 'none'));
end;
$$;

revoke execute on function public.forecast_request() from public, anon, authenticated;
revoke execute on function public.forecast_ingest() from public, anon, authenticated;
