// docs/api-contract.md의 응답 모양. 두 사람이 공유하는 유일한 타입 원본이다.
// 필드 추가는 자유, 삭제·이름 변경은 계약 문서 "요청"에 먼저 적고 상대 확인 후에 한다.

/** 0~39 safe, 40~69 caution, 70~100 danger */
export type Grade = 'safe' | 'caution' | 'danger';
export type Confidence = 'high' | 'medium' | 'low';
export type SpotType = 'jetty' | 'pier' | 'rocks' | 'beach' | 'estuary';
export type FloodFrequency = 'low' | 'medium' | 'high';

/** ISO 8601 UTC, 정시 단위. 예: "2026-11-25T15:00:00Z" */
export type IsoHour = string;

// ---- 1. GET /api/spots ----------------------------------------------------

export interface SpotSummary {
  id: string;
  name: string;
  type: SpotType;
  lat: number;
  lng: number;
  /** 0~100 정수, 높을수록 위험 */
  score: number;
  grade: Grade;
  confidence: Confidence;
}

export interface SpotsResponse {
  time: IsoHour;
  spots: SpotSummary[];
  /**
   * 그 시각에 발효 중인 경보. 하나라도 있으면 모든 포인트가 "danger"다. (2026-11-24 B 요청으로 추가)
   * 실제 API는 항상 채워 보낸다(없으면 빈 배열). B의 임시 시뮬레이터와 호환되도록 타입만 선택으로 둔다.
   */
  alerts?: RiskAlert[];
}

// ---- 2. GET /api/spots/{id}/risk ------------------------------------------

export interface Cause {
  code: string;
  /** 화면용 한국어 문장 */
  label: string;
}

export interface HourlyRisk {
  time: IsoHour;
  score: number;
  grade: Grade;
  /** 영향이 큰 순서, 최대 3개 */
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
  /** 화면용 한국어 문장 */
  headline: string;
  expires: string;
}

export interface SpotDetail {
  id: string;
  name: string;
  type: SpotType;
  lat: number;
  lng: number;
  access: { walkMinutes: number; from: string };
}

export interface TerrainSummary {
  score: number;
  slopeDeg: number;
  elevationM: number;
  cover: string;
  floodFrequency: FloodFrequency;
  factors: TerrainFactor[];
}

export interface SpotRiskResponse {
  spot: SpotDetail;
  terrain: TerrainSummary;
  hourly: HourlyRisk[];
  /** 하나라도 있으면 해당 시간의 grade는 "danger" */
  alerts: RiskAlert[];
  forecastFetchedAt: string;
  /** 예보 수집 후 6시간이 넘으면 true */
  stale: boolean;
  confidence: Confidence;
}

// ---- 3. GET /api/zones/grades ---------------------------------------------

export interface ZoneGradesResponse {
  time: IsoHour;
  /** zoneId → 등급 */
  grades: Record<string, Grade>;
}

// ---- 4. GET /api/recommendations ------------------------------------------

export interface RecommendationItem {
  id: string;
  name: string;
  type: SpotType;
  lat: number;
  lng: number;
  score: number;
  grade: Exclude<Grade, 'danger'>;
  walkMinutes: number;
  /** 화면용 한국어 문장 */
  reason: string;
}

export interface RecommendationsResponse {
  time: IsoHour;
  /** 최대 5곳 */
  items: RecommendationItem[];
}

// ---- 오류 -------------------------------------------------------------------

/** FORECAST_UNAVAILABLE(503): 예보를 아직 한 번도 수집하지 못함 */
export type ApiErrorCode = 'BAD_REQUEST' | 'OUT_OF_COVERAGE' | 'NOT_FOUND' | 'FORECAST_UNAVAILABLE' | 'INTERNAL';

export interface ApiErrorResponse {
  error: { code: ApiErrorCode; message: string };
}

// ---- 위험 구역 타일 -----------------------------------------------------------

/** PMTiles 레이어 이름 */
export const ZONES_LAYER = 'zones';

/** 구역 도형 속성 */
export interface ZoneFeatureProperties {
  zoneId: string;
  spotId?: string;
}
