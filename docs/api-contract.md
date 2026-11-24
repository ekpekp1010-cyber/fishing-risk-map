# API 계약 v0

개발자 A(데이터·위험도 엔진)와 개발자 B(3D 지도·UI)가 서로 기대하는 것을 적은 문서다.
B는 이 문서의 예시 응답(`lib/contract/fixtures/`)만으로 화면을 먼저 만들고, A는 같은 모양의 실제 응답을 구현한다.

- 본문은 A가 고친다. B는 맨 아래 "요청" 섹션에 추가한다.
- 필드 추가는 자유다. 삭제와 이름 변경은 "요청"에 적고 상대가 확인한 뒤에 한다.

## 공통 규칙

| 항목 | 규칙 |
| --- | --- |
| 시각 | ISO 8601 UTC, 정시 단위. 예: `2026-11-25T15:00:00Z` |
| 좌표 | WGS84 위경도. `lat`, `lng` |
| 점수 | 0~100 정수. 높을수록 위험 |
| 등급 `grade` | `"safe"`(0~39), `"caution"`(40~69), `"danger"`(70~100) |
| 신뢰도 `confidence` | `"high"`, `"medium"`, `"low"` |
| 장소 유형 `type` | `"jetty"`, `"pier"`, `"rocks"`, `"beach"`, `"estuary"` |
| 화면 문구 | `label`, `reason`, `headline`은 서버가 한국어 문장으로 만들어 준다 |
| 오류 | `{ "error": { "code": "...", "message": "..." } }`와 HTTP 상태 코드 |

오류 코드: `BAD_REQUEST`(400), `OUT_OF_COVERAGE`(404, 분석되지 않은 지역), `NOT_FOUND`(404), `FORECAST_UNAVAILABLE`(503, 그 시간대 예보를 아직 수집하지 못함), `INTERNAL`(500).

응답에는 `Cache-Control`이 붙는다. 등급은 정시 단위로 바뀌므로 다음 정시까지 캐시해도 된다.

## 1. 포인트 목록

`GET /api/spots?bbox=<서>,<남>,<동>,<북>&time=<시각>`

지도 화면 범위 안의 포인트와 그 시각의 등급을 돌려준다. `time`을 생략하면 현재 정시다.

```json
{
  "time": "2026-11-25T15:00:00Z",
  "spots": [
    {
      "id": "newport-south-jetty-01",
      "name": "사우스 제티 중간",
      "type": "jetty",
      "lat": 44.6131,
      "lng": -124.0712,
      "score": 78,
      "grade": "danger",
      "confidence": "medium"
    }
  ]
}
```

## 2. 포인트 상세와 시간대별 위험

`GET /api/spots/{id}/risk?from=<시각>&hours=<1~72>`

오른쪽 시트(모바일은 하단 시트)에 필요한 모든 것을 한 번에 돌려준다. `hours` 기본값은 72다.

```json
{
  "spot": {
    "id": "newport-south-jetty-01",
    "name": "사우스 제티 중간",
    "type": "jetty",
    "lat": 44.6131,
    "lng": -124.0712,
    "access": { "walkMinutes": 12, "from": "사우스 제티 주차장" }
  },
  "terrain": {
    "score": 64,
    "slopeDeg": 24,
    "elevationM": 3,
    "cover": "암반",
    "floodFrequency": "high",
    "factors": [
      { "code": "slope", "label": "급경사 암반", "score": 80 },
      { "code": "low_elevation", "label": "평균해면보다 3 m 높음", "score": 70 }
    ]
  },
  "hourly": [
    {
      "time": "2026-11-25T15:00:00Z",
      "score": 78,
      "grade": "danger",
      "causes": [
        { "code": "swell", "label": "너울 주기 13초, 파고 2.1 m" },
        { "code": "slope", "label": "급경사 암반, 물가까지 8 m" },
        { "code": "tide", "label": "16:40 만조, 퇴로가 저지대" }
      ]
    }
  ],
  "alerts": [
    { "source": "NWS", "event": "High Surf Advisory", "headline": "높은 파도 주의보 발효 중", "expires": "2026-11-26T06:00:00Z" }
  ],
  "forecastFetchedAt": "2026-11-25T14:10:00Z",
  "stale": false,
  "confidence": "medium"
}
```

- `causes`는 항상 영향이 큰 순서로 최대 3개다.
- `stale`은 예보 수집 후 6시간이 넘으면 `true`다. 화면은 '데이터 지연' 배지를 붙인다.
- `alerts`가 하나라도 있으면 해당 시간의 `grade`는 `"danger"`다.

## 3. 위험 구역

구역의 모양은 벡터 타일 파일 하나(PMTiles)로 제공하고, 시간에 따라 바뀌는 등급만 API로 받는다.

- 타일 주소: 환경 변수 `NEXT_PUBLIC_ZONES_PMTILES_URL`
- 타일 레이어 이름: `zones`
- 도형 속성: `zoneId`(문자열), `spotId`(문자열, 없을 수 있음)
- 지형 타일 주소: 환경 변수 `NEXT_PUBLIC_TERRAIN_TILES_URL` (terrain-RGB, `{z}/{x}/{y}` 형식)

`GET /api/zones/grades?time=<시각>`

```json
{
  "time": "2026-11-25T15:00:00Z",
  "grades": { "zone-0012": "danger", "zone-0013": "caution", "zone-0014": "safe" }
}
```

## 4. 추천

`GET /api/recommendations?lat=<위도>&lng=<경도>&time=<시각>&radiusKm=<기본 30>&excludeSpotId=<선택>`

같은 시각에 위험이 낮고 접근이 쉬운 포인트를 최대 5곳 돌려준다. `"danger"` 등급은 포함하지 않는다.
`excludeSpotId`를 주면 그 포인트보다 점수가 낮은 곳만 돌려준다.

```json
{
  "time": "2026-11-25T15:00:00Z",
  "items": [
    {
      "id": "newport-bay-st-pier",
      "name": "베이 스트리트 부두",
      "type": "pier",
      "lat": 44.6302,
      "lng": -124.0521,
      "score": 22,
      "grade": "safe",
      "walkMinutes": 3,
      "reason": "파랑이 가려지는 만 안쪽, 주차장에서 3분"
    }
  ]
}
```

## 예시 응답 파일

A는 위 네 응답의 예시를 `lib/contract/fixtures/`에 `spots.json`, `spot-risk.json`, `zone-grades.json`, `recommendations.json`으로 둔다.
세 등급과 `stale: true`, `alerts` 있음, 빈 목록 경우를 각각 하나 이상 포함한다. 좌표와 이름은 예시이며 실제 포인트 목록은 A의 1단계 산출물로 확정한다.

| 파일 | 경우 |
| --- | --- |
| `spots.json` | 세 등급 모두 |
| `spots-empty.json` | 빈 목록 |
| `spot-risk.json` | `alerts` 있음, 모든 시간 `danger` |
| `spot-risk-stale.json` | `stale: true`, `alerts` 없음 |
| `zone-grades.json` | 구역 등급 |
| `recommendations.json`, `recommendations-empty.json` | 추천 있음, 빈 목록 |

- 타입: `lib/contract/types.ts`. 타입이 붙은 예시는 `lib/contract/fixtures/index.ts`에서 가져온다.
- 예시의 값 규칙은 `pytest pipeline/tests`의 `test_contract_fixtures.py`가 검사한다.
- 서버 환경 변수 이름은 `.env.example`의 "서버" 구역에 있다.

## 변경 기록

| 날짜 | 버전 | 내용 |
| --- | --- | --- |
| 2026-11-24 | v0 | 첫 초안 |
| 2026-11-24 | v0 | 오류 코드 `FORECAST_UNAVAILABLE`(503) 추가. `/api/spots`, `/api/spots/{id}/risk` 구현(DB 연결 전) |
| 2026-11-24 | v0 | `lib/contract/types.ts`, fixtures 7개 추가. `ApiErrorResponse`, `ZONES_LAYER`, `ZoneFeatureProperties` 타입 추가(기존 필드 변경 없음) |

## 요청

상대에게 바라는 변경을 여기에 적는다. 형식: `- [ ] (날짜, 요청자) 무엇을, 왜`

- [x] (2026-11-24, B) `lib/contract/types.ts`와 `lib/contract/fixtures/`를 올려 주세요. 지금은 화면이 `lib/ui/api-types.ts`, `lib/ui/dev-fixtures.ts`의 임시 타입과 예시 데이터를 씁니다. 올라오면 그쪽으로 바꾸겠습니다.
  - (2026-11-24, A) 올렸습니다. 타입 이름은 `lib/ui/api-types.ts`와 같습니다. 포인트 id는 B의 임시 예시(`south-jetty-mid` 등)에 맞췄습니다. `RecommendationItem.grade`는 `danger`를 뺀 타입입니다.
- [ ] (2026-11-24, B) 지형 타일 주소와 위험 구역 PMTiles 주소를 알려 주세요. `.env.local`의 `NEXT_PUBLIC_TERRAIN_TILES_URL`, `NEXT_PUBLIC_ZONES_PMTILES_URL`에 넣으면 바로 바뀝니다. 구역 도형의 속성 이름은 계약대로 `zoneId`를 씁니다.
- [ ] (2026-11-24, B) API 네 개가 준비되면 알려 주세요. `NEXT_PUBLIC_USE_FIXTURES=0`으로 바꿔 연결을 확인하겠습니다.
  - (2026-11-24, A) 1·2번 API 코드는 올렸습니다. Supabase에 포인트·지형 점수가 들어가기 전에는 빈 목록이나 오류가 나오니 아직 예시 데이터를 쓰세요. 3·4번은 다음 차례입니다.
- [ ] (2026-11-24, B) 가능하면 경사, 과거 침수 흔적 래스터 타일도 부탁합니다. 지금 '경사' 레이어는 지형 음영으로 대신하고 있고, '과거 침수 흔적' 레이어는 꺼져 있습니다.

