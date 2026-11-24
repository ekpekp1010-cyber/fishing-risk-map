// 예시 응답을 계약 타입으로 내보낸다.
// JSON 모듈은 문자열 리터럴을 string으로 추론해 타입 검사로는 등급 같은 값을 잡지 못한다.
// 값 규칙(등급·점수 일치, 경보→danger, causes 3개 이하 등)은 pipeline/tests/test_contract_fixtures.py가 검사한다.
// 좌표·이름·점수는 예시이며 실제 포인트 목록은 개발자 A의 1단계 산출물로 확정한다.

import type {
  RecommendationsResponse,
  SpotRiskResponse,
  SpotsResponse,
  ZoneGradesResponse,
} from '../types';
import recommendationsEmptyJson from './recommendations-empty.json';
import recommendationsJson from './recommendations.json';
import spotRiskStaleJson from './spot-risk-stale.json';
import spotRiskJson from './spot-risk.json';
import spotsAlertJson from './spots-alert.json';
import spotsEmptyJson from './spots-empty.json';
import spotsJson from './spots.json';
import zoneGradesJson from './zone-grades.json';

function typed<T>(value: unknown): T {
  return value as T;
}

export const spots = typed<SpotsResponse>(spotsJson);
export const spotsEmpty = typed<SpotsResponse>(spotsEmptyJson);
export const spotsAlert = typed<SpotsResponse>(spotsAlertJson);
export const spotRisk = typed<SpotRiskResponse>(spotRiskJson);
export const spotRiskStale = typed<SpotRiskResponse>(spotRiskStaleJson);
export const zoneGrades = typed<ZoneGradesResponse>(zoneGradesJson);
export const recommendations = typed<RecommendationsResponse>(recommendationsJson);
export const recommendationsEmpty = typed<RecommendationsResponse>(recommendationsEmptyJson);
