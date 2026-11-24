-- 위험도 계산에 필요한데 초안에 빠진 열.

-- 퇴로 경로에서 가장 낮은 고도(조석 여유 계산용)
alter table public.terrain_scores add column egress_min_elevation_m real;

-- 체감온도, 야간 여부, 하천 유량 비(최근 30일 중앙값 대비)
alter table public.forecast_hourly
  add column apparent_temp_c real,
  add column is_dark boolean,
  add column river_ratio real;
