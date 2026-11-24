// supabase/migrations의 테이블 행 모양(필요한 열만). 스키마를 바꾸면 함께 고친다.

import type { Confidence, FloodFrequency, SpotType, TerrainFactor } from '../contract/types';

export interface ForecastCellRow {
  id: string;
  lat: number;
  lng: number;
}

export interface SpotRow {
  id: string;
  name: string;
  type: SpotType;
  lat: number;
  lng: number;
  access_walk_minutes: number | null;
  access_from: string | null;
  forecast_cell_id: string | null;
  active: boolean;
}

export interface TerrainScoreRow {
  spot_id: string;
  score: number;
  slope_deg: number | null;
  elevation_m: number | null;
  cover: string | null;
  flood_frequency: FloodFrequency | null;
  egress_min_elevation_m: number | null;
  factors: Array<TerrainFactor & { weight?: number; contribution?: number }>;
  confidence: Confidence;
}

export interface ForecastHourlyRow {
  cell_id: string;
  time: string;
  wave_height_m: number | null;
  wave_period_s: number | null;
  wave_direction_deg: number | null;
  swell_height_m: number | null;
  swell_period_s: number | null;
  swell_direction_deg: number | null;
  wind_speed_ms: number | null;
  wind_gust_ms: number | null;
  wind_direction_deg: number | null;
  precipitation_mm: number | null;
  weather_code: number | null;
  sea_level_m: number | null;
  sea_level_corrected_m: number | null;
  river_discharge_m3s: number | null;
  river_ratio: number | null;
  apparent_temp_c: number | null;
  is_dark: boolean | null;
  raw: unknown;
  fetched_at: string;
}

export interface AlertRow {
  id: string;
  source: string;
  event: string;
  headline: string | null;
  severity: string | null;
  onset: string | null;
  expires: string | null;
  fetched_at: string;
}
