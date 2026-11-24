# pipeline

개발자 A의 파이썬 배치: 데이터 내려받기 → 지표 계산 → 지형 취약성 V → DB 적재.

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -e "pipeline[dev]"
pytest pipeline/tests
```

## 1단계 실행 순서 (`pipeline/` 에서)

| 순서 | 명령 | 결과 |
| --- | --- | --- |
| 1 | `python -m fishrisk.osm` | `out/osm_raw.json`, `out/spot_candidates.geojson` (OSM 후보·주차장) |
| 2 | `python -m fishrisk.spots` | `review/spots_draft.csv` (포인트 초안, 사람이 검수) |
| 3 | `python -m fishrisk.rasters` | `data/grid/*.tif` (DEM·피복·물 출현 빈도·계절성, 30 m UTM 10N) |
| 4 | `python -m fishrisk.terrain` | `out/terrain_scores.json` (지표 7개, V, 도보 시간) |
| 5 | `python -m fishrisk.load_db` | Supabase `spots`, `terrain_scores` 적재(`.env.local` 필요) |

- `spots`는 검수 표가 이미 있으면 덮어쓰지 않는다(`--force`로 다시 만든다). 검수 때 `keep`을 `no`로, `name`·`note`를 고쳐 쓴다.
- 4·5는 검수 표의 `keep=yes`만 계산·활성화한다.

| 모듈 | 내용 |
| --- | --- |
| `fishrisk/config.py` | 시범 지역 범위, 예보 격자 셀 id 규칙, 제외 구역 |
| `fishrisk/osm.py` | Overpass 조회(예비 서버 포함), 후보 분류 |
| `fishrisk/spots.py` | 포인트 선정 규칙, 이름·id, 검수 표 |
| `fishrisk/rasters.py` | 공개 데이터 4종 내려받기, 공통 격자로 맞추기 |
| `fishrisk/terrain.py` | 경사·고도·수변 거리·침수 흔적·파랑 노출·지표·퇴로, 점수 기준 상수 |
| `fishrisk/terrain_score.py` | 요인 점수를 PRD 가중치로 합쳐 V와 기여도 |
| `fishrisk/load_db.py` | PostgREST로 upsert(service role 키는 출력하지 않음) |

내려받은 원본·격자·중간 결과는 `pipeline/data/`, `pipeline/out/`에 두며 커밋하지 않는다(`.gitignore`).

데이터 출처: Copernicus DEM GLO-30(© DLR/Airbus, ESA), ESA WorldCover 2021(CC BY 4.0),
JRC Global Surface Water v1.4("Source: EC JRC/Google"), © OpenStreetMap 기여자(ODbL).
