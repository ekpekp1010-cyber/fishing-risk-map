# 낚시 포인트 위험도 예측 3D 웹앱 PRD

Nov 24, 2026 · @somy's

위성·지형 데이터로 낚시 포인트 주변의 고정된 취약성을 계산하고, 기상·수위·해양 예보로 시간대별 위험을 더해, 포인트마다 안전·주의·위험과 그 원인을 3D 지도에 보여주는 웹앱이다. 1차 출시는 미국 오리건주 뉴포트 해안 한 구간을 대상으로 하고 국내는 이후 단계에 추가한다.

## 제품 개요

**문제.** 일반 기상 앱은 지역 단위 예보만 준다. 같은 바람과 파도라도 갯바위, 방파제, 하구, 백사장은 경사, 고도, 물가까지의 거리, 퇴로에 따라 위험이 크게 다르다. 낚시인은 포인트별 위험을 미리 비교할 방법이 없다.

**목표.** 낚시 포인트 하나를 고르면 '언제, 왜 위험한지'를 10초 안에 이해하게 한다. 날씨 확인을 넘어 포인트끼리 안전성을 비교하고, 더 안전한 대안을 바로 찾게 한다.

**타겟.** 낚시 스포츠를 즐기는 개인. 출조 전날 집에서 계획하는 사람과, 현장에서 휴대폰으로 다시 확인하는 사람 모두를 대상으로 한다.

| 구분 | 이번 MVP에 포함 | 이번 MVP에서 제외 |
| --- | --- | --- |
| 지역 | 미국 오리건주 뉴포트 해안 한 구간 | 국내, 전 세계 동시 커버 |
| 장소 유형 | 해안가(갯바위, 방파제, 백사장, 하구) | 내수면 저수지·계곡, 선상 낚시 |
| 기능 | 환경 분석, 위험도 표시, 3D 지도, 장소 추천 | 조황 예측, 커뮤니티, 예약·결제 |
| 플랫폼 | 반응형 웹(데스크톱, 모바일 브라우저) | 네이티브 앱, 오프라인 모드 |
| 정보 성격 | 출조 판단을 돕는 참고 정보 | 항해용 정보, 공식 경보 대체, 구조 신고 |

## 시범 지역

시범 지역은 미국 오리건주 뉴포트(Newport)의 야퀴나만 일대 한 구간이다. 북쪽 야퀴나 헤드에서 남쪽 사우스 비치까지 남북 약 9 km 해안이며, 실측 수위 관측소가 구간 안에 있어 위험도를 검증하기 좋다.

| 기준 | 이 구간이 맞는 이유 |
| --- | --- |
| 실측 수위 | NOAA 국가 수위 관측망 관측소 [South Beach(9435380)](https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/9435380.json)가 만 입구에 있다. 북위 44.625°, 서경 124.045° |
| 장소 유형 | 한 구간에 남·북 방파제, 만 안쪽 공용 부두([Bay St. Pier, Abbey St. Pier](https://myodfw.com/articles/where-go-crabbing-clamming-yaquina-bay)), 암반 곶, 모래 해변, 하구가 모두 있다 |
| 낚시 수요 | 오리건 어류야생동물부(ODFW)는 암반과 방파제에서 바닥고기(rockfish, lingcod), 모래 해변에서 서프퍼치(surfperch)를 낚는다고 [안내](https://myodfw.com/articles/oregon-marine-shore-fishing)한다 |
| 다루려는 위험 | ODFW가 해변·암반 낚시에서 스니커 웨이브(갑자기 밀려오는 큰 파도)와 방파제 발판을 조심하라고 명시한다 |
| 공식 경보 | [NWS 포틀랜드 사무소](https://www.weather.gov/pqr/)가 High Surf Advisory와 Coastal Flood Advisory를 낸다 |

- **검증 자료.** 같은 링컨 카운티의 실레츠만과 디포베이에서 스니커 웨이브 사망 사고가 보도됐다. 검색 결과로만 확인했고 기사를 열어 보지는 않았다. 등급 타당성 검증에는 이 일대 사고 기록을 모아 쓴다.
- **확인이 필요한 것.** 야퀴나 헤드는 보호 구역일 수 있어 낚시 허용 구역과 출입 규정을 확인해야 한다. 허용되지 않으면 구간 북쪽 끝을 아게이트 비치로 줄인다.
- **지형 보강 후보.** 미국은 USGS 3DEP와 NOAA Digital Coast에 1 m급 라이다 지형이 있다고 검색되지만, 공식 문서가 열리지 않아 이 구간의 제공 여부와 라이선스는 확인하지 못했다.

## 사용자 시나리오

핵심 흐름은 '지역 탐색 → 포인트 선택 → 시간대 확인 → 대안 비교' 네 단계다.

1. **출조 전 계획.** 지역을 검색해 3D 지도를 연다. 시간 슬라이더를 내일 새벽으로 옮기고, 구역 색으로 안전·주의·위험을 훑어본다.
2. **포인트 확인.** 가려던 갯바위 핀을 누른다. 등급과 원인 상위 3개, 시간대별 위험 변화를 본다.
3. **대안 비교.** 등급이 '위험'이면 '더 안전한 곳 추천'을 눈러 같은 시간대에 위험이 낮고 접근이 쉬운 포인트를 받는다.
4. **현장 재확인.** 도착 후 휴대폰으로 같은 포인트를 열어, 만조 시각과 퇴로 위험이 언제 올라가는지 확인한다.

## MVP 기능 요구사항

기능은 4개이고 개발 순서도 이 순서를 따른다. 수치는 초기 제안값이며 시범 지역 검증 후 조정한다.

### F1. 위성·지형 데이터 기반 낚시 환경 분석

- 포인트 반경 500 m를 30 m 격자로 분석한다.
- 산출 항목: 경사, 평균해면 대비 고도, 수변 경계까지 거리, 지표 피복(암반·식생·모래·인공물), 과거 물 출현 빈도, 파랑 노출 방향, 퇴로(가장 가까운 도로·주차장까지 거리와 고도차).
- 결과는 포인트별 지형 취약성 점수(0\~100)와 요인별 기여도로 저장한다.
- 배치로 사전 계산한다. 위성 영상이 갱신되면 월 1회 다시 계산한다.
- 수용 기준: 시범 구간 포인트 30개 이상에 점수가 생성되고, 각 점수에 사용한 데이터의 촬영·제작 연도가 함께 저장된다.

### F2. 낚시 포인트별 위험도 표시

- 등급은 안전, 주의, 위험 3단계다. 색만으로 구분하지 않고 아이콘과 글자를 함께 쓴다.
- 1시간 단위로 향후 72시간을 계산한다.
- 등급마다 원인 상위 3개를 사람이 읽는 문장으로 보여준다. 예: "너울 주기 13초, 파고 2.1 m".
- 예보 수집 시각과 신뢰도(높음·보통·낮음)를 항상 표시한다.
- 수용 기준: 어떤 포인트·시각을 골라도 등급, 원인, 수집 시각 세 가지가 빠짐없이 나온다. 예보가 6시간 이상 오래되면 '데이터 지연' 표시가 붙는다.

### F3. 3D 낚시 지도

- 지형을 3D로 그리고 그 위에 안전·주의·위험 구역과 포인트 핀을 올린다.
- 시간 슬라이더를 움직이면 구역 색과 핀 등급이 함께 바뀐다.
- 회전, 기울이기, 확대를 지원하고 2D 보기로 전환할 수 있다.
- 레이어 토글: 위험 구역, 경사, 과거 침수 흔적, 위성 영상.
- 수용 기준: 중급 휴대폰 브라우저에서 지도 조작이 끊기지 않는다. WebGL을 쓸 수 없는 기기는 2D 지도로 자동 전환된다.

### F4. 안전 낚시 장소 추천

- 현재 화면 범위 또는 반경 30 km 안에서 선택한 시간대의 위험도가 낮고 접근성이 좋은 포인트 5곳을 추천한다.
- 접근성은 주차장·도로에서 도보 거리와 고도차로 계산한다.
- 추천마다 이유를 한 줄로 붙인다. 예: "파랑이 가려지는 방파제 안쪽, 주차장에서 3분".
- '위험' 등급 포인트는 추천에서 제외한다.
- 수용 기준: 추천 목록의 모든 항목이 같은 시간대 기준 현재 포인트보다 위험 점수가 낮다.

## 위험도 모델

위험도는 잘 변하지 않는 지형 취약성 V와 시간마다 바뀌는 위험요인 H(t)를 합쳐 0\~100점으로 만든다. 가중치와 임계값은 모두 초기 제안값이며, 시범 지역의 과거 사고 사례로 보정한다.

```latex
R(t) = \min\bigl(100,\; 0.4\,V + 0.6\,H(t) + B(t)\bigr)
```

- V: 지형 취약성 점수(0\~100). 포인트마다 한 번 계산해 저장한다.
- H(t): 시간대 위험요인 점수(0\~100). 요인별 점수의 가중합과 최댓값 중 큰 쪽을 쓴다. 한 요인만 극단적이어도 놓치지 않기 위해서다.
- B(t): 지형과 기상이 겹칠 때 더하는 가산점(0\~20). 예: 저지대 포인트에 만조가 겹침, 급경사 암반에 긴 주기 너울이 겹침.
- 등급: 0\~39 안전, 40\~69 주의, 70\~100 위험.
- 강제 규칙: 해당 지역에 공식 기상·해양 경보(시범 지역은 미국 NWS 경보)가 발효 중이거나 뇌우가 예보되면 점수와 무관하게 '위험'으로 표시한다.

### 지형 취약성 V (정적)

| 요인 | 산출 방법 | 사용 데이터 | 가중치 |
| --- | --- | --- | --- |
| 경사 | 포인트 반경 100 m 평균·최대 경사각 | Copernicus DEM | 20% |
| 저지대 여부 | 평균해면 대비 고도. 낮을수로 점수 높음 | Copernicus DEM | 20% |
| 과거 침수 흔적 | 주변 격자의 물 출현 빈도와 계절성 | JRC Global Surface Water | 15% |
| 수변 근접도 | 최신 수변 경계까지 수평 거리 | Sentinel-2 수체 지수 | 10% |
| 파랑 노출 | 개방 수면이 열린 방위와 거리 | Sentinel-2 수변 경계, GEBCO 수심 | 15% |
| 지표 상태 | 암반·나지(미끄러움), 식생, 인공 구조물 구분 | ESA WorldCover, Sentinel-2 식생 지수 | 10% |
| 퇴로 | 도로·주차장까지 거리, 경로상 저지대 구간 | OpenStreetMap, Copernicus DEM | 10% |

### 시간대 위험요인 H(t) (동적)

| 요인 | 변수 | 주의 시작 | 위험 시작 | 사용 데이터 |
| --- | --- | --- | --- | --- |
| 파랑 | 유의파고 | 1.0 m | 2.0 m | Open-Meteo Marine |
| 너울 | 너울 주기(파고 1 m 이상일 때) | 10초 | 14초 | Open-Meteo Marine |
| 바람 | 10 m 풍속, 돌풍 | 8 m/s | 14 m/s | Open-Meteo Forecast |
| 강수 | 시간당 강수량 | 5 mm | 20 mm | Open-Meteo Forecast |
| 뇌우 | 뇌우 예보 여부 | 해당 없음 | 예보 시 즉시 | Open-Meteo Forecast |
| 조석 | 예측 해수면과 포인트·퇴로 고도의 차 | 1.0 m 이내 | 0.5 m 이내 | Open-Meteo Marine, 조석 모델 |
| 하천 유량(하구) | 최근 30일 중앙값 대비 유량 | 2배 | 4배 | Open-Meteo Flood (GloFAS) |
| 기온 | 체감온도 | 0°C 이하, 31°C 이상 | -10°C 이하, 35°C 이상 | Open-Meteo Forecast |
| 시야 | 일몰 후, 일출 전 | 해당 시간대 | 다른 요인과 겹칠 때 가산 | 천문 계산 |

**신뢰도 표시.** Copernicus DEM은 30 m 격자의 표면 모델이라 갯바위 하나 단위의 높낮이는 구분하지 못한다. Open-Meteo도 연안 정확도가 제한적이라고 밝힌다. 그래서 저지대·조석 판정처럼 고도에 민감한 결과에는 '신뢰도 낮음'을 붙이고, 등급은 더 위험한 쪽으로 판정한다.

## 위성·지형 데이터

필요한 위성·지형 데이터는 모두 무료로 구할 수 있고, 대부분 계정 없이 AWS 공개 버킷에서 바로 내려받는다. MVP는 아래 6종으로 시작한다.

| 데이터 | 어디에 쓰나 | 해상도·기간 | 접근 경로 | 라이선스 |
| --- | --- | --- | --- | --- |
| [Copernicus DEM GLO-30](https://registry.opendata.aws/copernicus-dem/) | 고도, 경사, 저지대, 3D 지형 타일 | 30 m 표면 모델(DSM). 바다는 타일 없음 | AWS S3 `copernicus-dem-30m`, 계정 불필요 | 일반 공개 무료. 일부 국가 타일은 미공개 |
| [Sentinel-2 L2A](https://registry.opendata.aws/sentinel-2-l2a-cogs/) | 최신 수변 경계(수체 지수), 식생(식생 지수), 위성 영상 레이어 | 광학 10 m. 전 세계 2018년 12월부터 | Earth Search STAC `earth-search.aws.element84.com/v1`, 계정 불필요 | Copernicus Sentinel 데이터: 무료, 전면 공개 |
| [Sentinel-1 GRD](https://documentation.dataspace.copernicus.eu/APIs/STAC.html) | 구름이 끼어도 수면 탐지, 침수 흔적 보강 | 레이더(SAR) | Copernicus Data Space STAC `stac.dataspace.copernicus.eu/v1`, 가입 필요 | Copernicus Sentinel 데이터 |
| [JRC Global Surface Water v1.5](https://global-surface-water.appspot.com/download) | 과거 침수 흔적: 물 출현 빈도, 계절성, 최대 수면 범위 | Landsat 30 m, 1984\~2024년 | 10°×10° 타일 다운로드, Earth Engine | 무료, 사용 제한 없음. "Source: EC JRC/Google" 표기 |
| [ESA WorldCover](https://esa-worldcover.org/en/data-access) | 지표 피복 11종: 나지, 식생, 습지, 건물 등 | 10 m, 2020·2021년 | AWS S3 `esa-worldcover`, 계정 불필요 | CC BY 4.0 |
| [GEBCO\_2026 Grid](https://www.gebco.net/data-products/gridded-bathymetry-data) | 근해 수심. 파랑 노출 계산의 보조 자료 | 15초각 격자 | 전체 격자 다운로드 | 퍼블릭 도메인, 출처 표기 요청 |
|  |  |  |  |  |

- **선택 기준.** 정적 분석은 DEM, 지표수, 피복 세 가지만으로도 성립한다. Sentinel-2는 해안선이 바뀌는 곳의 최신 수변 경계를 맞추는 데 쓰고, Sentinel-1은 MVP 이후로 미뤄도 된다.
- **처리 한도.** Copernicus Data Space 무료 계정은 30일에 12 TB까지 내려받을 수 있고 동시 연결은 4개다. Sentinel Hub 처리는 월 10,000 처리 단위다. 시범 지역 1곳에는 충분하다. ([쿼터 문서](https://documentation.dataspace.copernicus.eu/Quotas.html))
- **포인트와 접근성.** 방파제, 부두, 도로, 주차장, 해안선은 OpenStreetMap에서 추출한다. OSM 라이선스와 태그 품질은 이번 조사에서 페이지를 열어 확인하지 않았다.
- **확인하지 못한 후보.** MODIS 기반 Global Flood Database는 페이지가 열리지 않아 건수, 해상도, 라이선스를 확인하지 못했다.

## 기상·수위·해양 데이터

전 세계 예보는 Open-Meteo 하나로 시작한다. 키 없이 파랑, 해수면, 강수, 바람, 하천 유량을 모두 받을 수 있다. 단, 무료 사용은 비상업 용도로 제한된다.

| API·모델 | 제공 변수 | 범위·해상도 | 비용·한도 | 제약 |
| --- | --- | --- | --- | --- |
| Open-Meteo Forecast | 강수, 풍속·돌풍, 기온, 뇌우 | 전 세계, 1시간 단위 | [무료](https://open-meteo.com/en/pricing): 하루 10,000회, 월 300,000회. 비상업 전용 | 상업 이용은 유료 플랜(월 100만 회부터, 가격 미표시) |
| [Open-Meteo Marine](https://open-meteo.com/en/docs/marine-weather-api) | 파고·파향·주기, 너울, 해수면 높이(조석 포함), 해류, 수온 | 전 세계. 파랑 5\~25 km, 조석·해류 약 8 km | 위와 같은 한도 | 연안 정확도 제한. 해수면 기준은 평균해면. 항해용 부적합이라고 명시 |
| [Open-Meteo Flood](https://open-meteo.com/en/docs/flood-api) | 하천 유량(GloFAS v4), 앙상블 통계 | 전 세계 5 km, 일 단위, 기본 92일 예보 | 위와 같은 한도 | 5 km 격자라 가까운 하천이 잘못 잡힐 수 있음 |
| [EOT20 조석 모델](https://www.seanoe.org/data/00683/79489/) | 조석 성분 17개로 만조·간조 시각과 높이 자체 계산 | 1/8° 격자, 남북위 66° 이내 | 무료, NetCDF 약 2 GB | CC BY 4.0. 직접 계산 코드가 필요 |
| [FES2022 조석 모델](https://www.aviso.altimetry.fr/en/data/products/auxiliary-products/global-tide-fes/release-fes22.html) | 전 세계 조석 높이. 예측 소프트웨어 LIBFES 오픈소스 | 전 세계 | 무료, AVISO 가입 필요 | 높이 자료는 상업 포함 모든 용도 허용. 출처 표기 필수 |
| [NOAA CO-OPS API](https://api.tidesandcurrents.noaa.gov/api/prod/) | 실측 수위, 조석 예측, 바람, 수온, 해류 | NOAA 관측소(예시는 모두 미국) | 무료. 조회 기간 제한: 6분 자료 1개월, 시간 자료 1년 | 대량 조회는 속도 제한. 호출 사이 대기 권장 |
| [미국 NWS API](https://www.weather.gov/documentation/services-web-api) | 발효 중인 기상 경보 | 미국 기상청 관할 | 무료, 키 불필요(User-Agent 필수) | 속도 제한 수치 비공개 |

- **호출 전략.** 포인트마다 부르지 않고 0.05° 격자 셀로 묶어 1시간마다 수집해 캐시한다. 무료 한도 하루 10,000회면 약 400개 셀을 매시간 갱신할 수 있다.
- **조석.** MVP는 Open-Meteo 해수면 높이를 쓴다. 정확도가 부족하면 EOT20이나 FES2022로 자체 예측을 더하고, 시범 지역이 미국이므로 가까운 NOAA 관측소의 실측 수위로 보정한다.
- **출처 표기.** Open-Meteo 데이터는 [CC BY 4.0](https://open-meteo.com/en/licence)이다. 데이터가 보이는 화면마다 "Weather data by Open-Meteo.com" 링크를 둔다.
- **상용 대안.** Stormglass와 WorldTides 같은 유료 조석 API도 있다. 가격과 한도는 검색 결과로만 봤고 공식 페이지를 열어 확인하지 않았다.

## 기술 스택과 아키텍처

추천 스택은 Next.js, MapLibre GL JS, Supabase(PostGIS), Python 배치 파이프라인이다. 서버를 직접 운영하지 않고, 무거운 위성 분석은 미리 계산해 두기 때문에 웹 앱은 가볍게 유지된다.

&#91;embedded content: 시스템 아키텍처 · 정적 경로와 동적 경로\]

왼쪽 열은 위성·지형 데이터가 바뀔 때만 다시 돌고, 오른쪽 열은 1시간마다 돈다. 두 결과는 위험도 API에서 합쳐져 웹 앱으로 간다.

| 영역 | 추천 | 선택 근거 | 대안 |
| --- | --- | --- | --- |
| 프런트엔드 | Next.js(App Router), TypeScript | 화면과 API를 한 프로젝트로 관리, Vercel 배포와 바로 연결 | Vite + React |
| UI | Material 3 토큰(CSS 변수)과 컴포넌트 | 폴더의 Material 3 Design Kit과 같은 체계 | 없음 |
| 3D 지도 | [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/) v6, deck.gl | 오픈소스, 3D 지형과 지구본 보기 지원, 모바일 웹에서 가벼움 | [CesiumJS](https://github.com/CesiumGS/cesium) (Apache-2.0) |
| 지형 타일 | Copernicus DEM으로 terrain-RGB 타일 직접 제작, PMTiles로 배포 | 타일 사용료 없음 | [MapTiler Cloud](https://www.maptiler.com/cloud/pricing/): 무료 월 10만 요청, Flex 월 30달러 |
| 배경 지도 | OpenStreetMap 기반 벡터 타일, Sentinel-2 영상 레이어 | 무료, 해안 시설 표기 포함 | MapTiler 위성 영상 |
| 데이터베이스 | Supabase Postgres, PostGIS | 반경 검색, 최근접 도로 같은 공간 질의를 SQL로 처리 | 자체 운영 PostGIS |
| 배치 분석 | Python: rasterio, GDAL, rioxarray, pystac-client, geopandas, WhiteboxTools | 위성·지형 처리의 표준 오픈소스 묶음 | Google Earth Engine |
| 타일 제작 | tippecanoe(벡터), rio-rgbify(지형) | 결과를 파일 하나(PMTiles)로 만들어 스토리지에서 바로 제공 | Martin 타일 서버 |
| 예보 수집 | Vercel Cron에서 Route Handler 호출, Postgres에 캐시 | 별도 서버 없이 주기 실행 | Supabase pg\_cron |
| 조석 계산(선택) | EOT20 또는 FES2022와 LIBFES | 해수면 예보가 부정확한 연안을 보강 | 유료 조석 API |
| 배포 | Vercel(웹, API), Supabase(DB, 스토리지), GitHub Actions(배치) | 무료 등급으로 시작 가능 | 없음 |

**3D 엔진은 MapLibre로 시작한다.** 지형 원천이 30 m DEM이라 CesiumJS의 정밀 3D 기능을 쓸 일이 적고, MapLibre가 더 가볍다. 사진 같은 3D가 필요해지면 CesiumJS와 Google Photorealistic 3D Tiles로 갈 수 있지만 비용이 든다. Google은 월 1,000건까지 무료이고 이후 1,000건당 6달러다([가격표](https://developers.google.com/maps/billing-and-pricing/pricing)). Cesium ion 무료 등급은 비상업 용도에 월 15 GB 스트리밍이고, 상업 등급은 월 149달러부터다([가격표](https://cesium.com/platform/cesium-ion/pricing/)).

## 메인 화면 UI/UX

메인 화면은 3D 지도 하나다. 지도가 화면을 채우고 검색, 필터, 시간 슬라이더, 포인트 상세가 그 위에 얹힌다. 디자인 시스템은 폴더의 Material 3 Design Kit을 따른다.

&#91;embedded content: 메인 화면 와이어프레임 · 데스크톱, 포인트 선택 상태\]

사용자는 왼쪽 위에서 지역을 찾고, 아래 슬라이더로 시간을 고르고, 핀을 눌러 오른쪽 시트에서 등급과 원인을 읽는다. 포인트를 고르지 않았을 때 오른쪽 시트는 추천 5곳 목록을 보여준다.

### 화면 구성과 Material 3 컴포넌트

| 영역 | Material 3 컴포넌트 | 내용과 동작 |
| --- | --- | --- |
| 내비게이션 | Navigation rail(데스크톱), Navigation bar(모바일) | 목적지 4개: 지도, 추천, 저장, 설정 |
| 검색 | Search bar, 누르면 Search view | 지역명·포인트명 검색, 최근 검색 표시. 결과를 고르면 카메라가 날아감 |
| 필터 | Filter chips | 장소 유형(방파제, 갯바위, 백사장, 하구)과 '안전만 보기' |
| 3D 지도 | 지도 캔버스(커스텀) | 3D 지형 위에 위험 구역 면과 포인트 핀. 드래그로 이동, 두 손가락으로 회전·기울이기 |
| 지도 컨트롤 | Segmented button(2D·3D), Icon button(레이어), FAB(내 위치) | 레이어는 위험 구역, 경사, 과거 침수 흔적, 위성 영상 네 가지 |
| 시간 슬라이더 | Slider, Icon button(재생) | 지금부터 +72시간, 1시간 단위. 움직이면 구역 색, 핀, 시트가 함께 바뀜 |
| 포인트 상세 | Side sheet(데스크톱), Bottom sheet(모바일) | 등급 배지, 원인 상위 3, 시간대별 위험 띠, 지형 요약, 수집 시각과 신뢰도 |
| 행동 버튼 | Filled button, Outlined button | '더 안전한 곳 추천'이 주 버튼, '저장'이 보조 버튼 |
| 추천 목록 | List(3줄 항목) | 포인트명, 등급, 추천 이유 한 줄. 누르면 해당 포인트로 이동 |
| 알림 | Snackbar | 데이터 지연, 불러오기 실패 |
| 안전 고지 | 시트 하단 고정 문구 | "참고 정보이며 현지 경보와 통제를 대신하지 않는다" |

### 등급 표현과 토큰

등급은 색, 모양, 글자 세 가지로 함께 표시한다. 색각 이상이 있어도 구분되어야 하기 때문이다.

| 등급 | 색 역할 | 핀 모양 | 표시 문구 |
| --- | --- | --- | --- |
| 안전 | 확장 색 safe(녹색 계열)와 그 container | 원 | 안전 |
| 주의 | 확장 색 caution(황색 계열)과 그 container | 삼각형 | 주의 |
| 위험 | error, error container | 팔각형 | 위험 |

- 색: 배경은 surface, 시트는 surface container, 선택과 슬라이더는 primary, 보조 글자는 on surface variant 역할을 쓴다. 안전·주의 색은 Material 3의 확장 색(custom color)으로 추가한다.
- 글자: 포인트명 Title Large, 등급 Title Medium, 원인 문장 Body Medium, 칩과 버튼 Label Large, 수집 시각 Label Small.
- 모양: 시트 모서리 Extra large(28dp), 칩 Small(8dp), 버튼과 검색 바 Full.
- 높이: 지도 위에 뜨는 검색 바와 FAB는 level 3, 시트는 level 1.

### 화면 상태

| 상태 | 화면에 보이는 것 |
| --- | --- |
| 기본(선택 없음) | 오른쪽 시트에 현재 화면 범위의 추천 5곳 |
| 포인트 선택 | 위 와이어프레임과 같음. 선택한 핀에 강조 테두리 |
| 시간 변경 | 구역 색, 핀, 시트의 등급과 원인이 동시에 바뀜 |
| 불러오는 중 | 시트는 뼈대 화면, 지도 상단에 Linear progress indicator |
| 데이터 지연 | 예보가 6시간 이상 지나면 수집 시각 옆에 '데이터 지연' 배지와 Snackbar |
| 지원 범위 밖 | "이 지역은 아직 분석되지 않았다"와 가장 가까운 지원 지역으로 가는 버튼 |
| WebGL 불가 | 2D 지도로 전환하고 한 번만 알림 |

### 반응형

- Compact(600dp 미만): 지도가 전체 화면이다. 하단에 Navigation bar를 두고, 포인트 상세는 Bottom sheet 3단으로 연다. 접힌 높이는 등급 한 줄, 중간은 원인 상위 3, 펼친 높이는 전체다.
- Medium(600\~839dp): Navigation rail과 Bottom sheet를 쓴다.
- Expanded(840dp 이상): 위 와이어프레임과 같다. Side sheet 폭은 360dp다.

### 접근성

- 터치 대상은 48dp 이상, 글자 대비는 4.5:1 이상으로 한다.
- 핀은 키보드로 순서대로 이동할 수 있고, 등급과 원인 문장을 스크린 리더가 읽는다.
- 3D 조작이 어려운 사용자를 위해 추천 목록만으로도 같은 정보를 얻을 수 있게 한다.

Design Kit 파일(.fig)은 Figma 전용 형식이라 이 문서를 쓰면서 내용을 직접 열어 보지 못했다. 위 명세는 Material 3 공개 규격 기준이며, 기준 색과 컴포넌트 변형은 Figma에서 킷을 열어 확정해야 한다.

## 로드맵

개발은 MVP 기능 순서 그대로 네 단계로 진행하고, 국내 지역은 공개 이후에 추가한다.

&#91;embedded content: 로드맵 · 4단계와 게이트 4개, 이후 국내 추가\]

각 단계는 앞 단계의 산출물을 입력으로 쓴다. 게이트를 통과하지 못하면 다음 단계로 가지 않고 가중치와 임계값을 다시 조정한다. 단계별 기간은 팀 규모가 정해지면 붙인다.

## 성공 지표, 리스크와 안전 고지

가장 중요한 지표는 등급의 타당성이다. 과거 사고가 난 지점과 시각을 다시 계산했을 때 '주의' 이상으로 나와야 한다. 아래 목표값은 초기 제안이다.

| 지표 | 목표 | 측정 방법 |
| --- | --- | --- |
| 등급 타당성 | 과거 사고 사례의 80% 이상이 '주의' 또는 '위험'으로 재현 | 시범 지역 사고 보도·구조 기록을 수집해 재계산 |
| 원인 이해 시간 | 포인트 선택 후 10초 안에 위험 원인을 말할 수 있음 | 사용자 5명 관찰 테스트 |
| 첫 화면 속도 | 휴대폰 4G에서 지도 조작 가능까지 4초 이내 | 브라우저 성능 측정 |
| 예보 신선도 | 표시 데이터의 95%가 수집 후 2시간 이내 | 캐시 수집 시각 로그 |
| 추천 활용 | '위험' 포인트를 본 사용자의 30% 이상이 추천 포인트를 열어 봄 | 이벤트 로그 |

| 리스크 | 영향 | 대응 |
| --- | --- | --- |
| 30 m DEM의 한계 | 갯바위 단위의 높낮이와 고립 위험을 놓침 | 신뢰도 표시, 위험한 쪽으로 판정, 국가별 고해상도 지형으로 보강 |
| 연안 예보 정확도 | 파고·해수면이 실제와 다를 수 있음 | 관측소 실측으로 보정, 자체 조석 모델 추가 |
| '안전' 표시를 믿고 난 사고 | 사용자 피해와 법적 책임 | 고지 상시 노출, 공식 경보 우선, 약관 법률 검토 |
| 무료 API의 비상업 제한 | 수익화 시 약관 위반 | 수익화 전 유료 플랜 전환, 호출 캐시 |
| 모바일 3D 성능 | 저사양 기기에서 끊김 | 2D 자동 전환, 타일 해상도 단계 조정 |
| 포인트 데이터 품질 | OpenStreetMap 태그가 지역마다 다름 | 시범 지역은 사람이 검수 |
| 출처 표기 누락 | 라이선스 위반 | 설정 화면에 데이터 출처 목록, 지도 하단에 표기 |

**안전 고지.** 모든 등급 표시 옆에 다음 문구를 둔다: "이 정보는 출조 판단을 돕는 참고 자료이며, 현지 경보·통제와 본인의 현장 판단을 대신하지 않는다." '안전' 등급은 위험이 없다는 뜻이 아니라 계산된 위험이 낮다는 뜻임을 처음 사용할 때 안내한다.

## 열린 질문

- [ ] 야퀴나 헤드에서 낚시가 허용되는가?

  허용되지 않으면 시범 구간의 북쪽 끝을 아게이트 비치로 줄인다.
- [ ] 수익화를 할까?

  한다면 Open-Meteo 유료 플랜과 지도 타일 비용을 예산에 넣어야 한다.
- [ ] 3D 엔진을 MapLibre로 확정할까, CesiumJS로 갈까?
- [ ] 포인트를 OpenStreetMap에서 자동 추출할까, 사람이 골라 등록할까?
- [ ] '안전' 등급 명칭을 '위험 낮음'으로 바꿀까?
- [ ] Material 3 테마의 기준 색과 서비스 이름은 무엇인가?
- [ ] 로그인과 '저장' 기능을 MVP에 넣을까?
- [ ] 팀 규모와 일정은 어떻게 되는가?

## 출처

2026년 11월 24일에 직접 열어 확인한 페이지다.

- [Copernicus DEM, AWS 공개 데이터](https://registry.opendata.aws/copernicus-dem/)
- [Sentinel-2 L2A COG, AWS 공개 데이터](https://registry.opendata.aws/sentinel-2-l2a-cogs/)
- [Copernicus Data Space STAC 문서](https://documentation.dataspace.copernicus.eu/APIs/STAC.html)
- [Copernicus Data Space 쿼터](https://documentation.dataspace.copernicus.eu/Quotas.html)
- [JRC Global Surface Water 다운로드](https://global-surface-water.appspot.com/download)
- [ESA WorldCover 데이터 접근](https://esa-worldcover.org/en/data-access)
- [GEBCO 격자 수심 데이터](https://www.gebco.net/data-products/gridded-bathymetry-data)
- [Open-Meteo 가격](https://open-meteo.com/en/pricing)
- [Open-Meteo Marine Weather API](https://open-meteo.com/en/docs/marine-weather-api)
- [Open-Meteo Flood API](https://open-meteo.com/en/docs/flood-api)
- [Open-Meteo 라이선스](https://open-meteo.com/en/licence)
- [EOT20 조석 모델, SEANOE](https://www.seanoe.org/data/00683/79489/)
- [FES2022 조석 모델, AVISO](https://www.aviso.altimetry.fr/en/data/products/auxiliary-products/global-tide-fes/release-fes22.html)
- [NOAA CO-OPS Data API](https://api.tidesandcurrents.noaa.gov/api/prod/)
- [미국 NWS API](https://www.weather.gov/documentation/services-web-api)
- [Google Photorealistic 3D Tiles](https://developers.google.com/maps/documentation/tile/3d-tiles)
- [Google Maps Platform 가격표](https://developers.google.com/maps/billing-and-pricing/pricing)
- [Cesium ion 가격](https://cesium.com/platform/cesium-ion/pricing/)
- [CesiumJS 저장소](https://github.com/CesiumGS/cesium)
- [MapLibre GL JS 문서](https://maplibre.org/maplibre-gl-js/docs/)
- [MapTiler Cloud 가격](https://www.maptiler.com/cloud/pricing/)

* [NOAA 관측소 9435380 South Beach 메타데이터](https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/9435380.json)
* [ODFW 오리건 해안 낚시 안내](https://myodfw.com/articles/oregon-marine-shore-fishing)
* [ODFW 야퀴나만 접근 지점](https://myodfw.com/articles/where-go-crabbing-clamming-yaquina-bay)
* [NWS 포틀랜드 사무소](https://www.weather.gov/pqr/)
