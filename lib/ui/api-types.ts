// docs/api-contract.md v0의 응답 모양을 화면 쪽에서 쓰기 위한 타입.
// 개발자 A가 lib/contract/types.ts를 올리면 이 파일은 그쪽을 다시 내보내는 것으로 바꾼다.

export type Grade = 'safe' | 'caution' | 'danger';
export type Confidence = 'high' | 'medium' | 'low';
export type SpotType = 'jetty' | 'pier' | 'rocks' | 'beach' | 'estuary';
export type FloodFrequency = 'low' | 'medium' | 'high';

export interface SpotSummary {
  id: string;
  name: string;
  type: SpotType;
  lat: number;
  lng: number;
  score: number;
  grade: Grade;
  confidence: Confidence;
}

export interface SpotsResponse {
  time: string;
  spots: SpotSummary[];
}

export interface Cause {
  code: string;
  label: string;
}

export interface HourlyRisk {
  time: string;
  score: number;
  grade: Grade;
  causes: Cause[];
}

export interface TerrainFactor {
  code: string;
  label: string;
  score: number;
}

export interface RiskAlert {
  source: string;
  event: string;
  headline: string;
  expires: string;
}

export interface SpotRiskResponse {
  spot: {
    id: string;
    name: string;
    type: SpotType;
    lat: number;
    lng: number;
    access: { walkMinutes: number; from: string };
  };
  terrain: {
    score: number;
    slopeDeg: number;
    elevationM: number;
    cover: string;
    floodFrequency: FloodFrequency;
    factors: TerrainFactor[];
  };
  hourly: HourlyRisk[];
  alerts: RiskAlert[];
  forecastFetchedAt: string;
  stale: boolean;
  confidence: Confidence;
}

export interface ZoneGradesResponse {
  time: string;
  grades: Record<string, Grade>;
}

export interface RecommendationItem {
  id: string;
  name: string;
  type: SpotType;
  lat: number;
  lng: number;
  score: number;
  grade: Grade;
  walkMinutes: number;
  reason: string;
}

export interface RecommendationsResponse {
  time: string;
  items: RecommendationItem[];
}

export type ApiErrorCode = 'BAD_REQUEST' | 'OUT_OF_COVERAGE' | 'NOT_FOUND' | 'INTERNAL';
