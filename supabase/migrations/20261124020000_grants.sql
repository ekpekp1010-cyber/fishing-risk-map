-- 테이블 권한. 새 Supabase 프로젝트는 public 테이블에 읽기·쓰기 권한을 자동으로 주지 않는다.
-- 서버(service_role)만 읽고 쓴다. 브라우저 키(anon·authenticated)에는 아무 권한도 주지 않는다.

grant usage on schema public to service_role;

grant select, insert, update, delete on table
  public.forecast_cells,
  public.spots,
  public.terrain_scores,
  public.zones,
  public.forecast_hourly,
  public.alerts
to service_role;

revoke all on table
  public.forecast_cells,
  public.spots,
  public.terrain_scores,
  public.zones,
  public.forecast_hourly,
  public.alerts
from anon, authenticated;

-- 앞으로 만드는 테이블도 같은 규칙을 따르게 한다.
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public revoke all on tables from anon, authenticated;
