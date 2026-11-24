# pipeline

개발자 A의 파이썬 배치: 데이터 내려받기 → 지표 계산 → 지형 취약성 V → 구역·지형 타일.

```bash
python -m pip install -e "pipeline[dev]"
pytest pipeline/tests
```

| 모듈 | 내용 |
| --- | --- |
| `fishrisk/config.py` | 시범 지역 범위, 예보 격자 셀 id 규칙, 제외 구역 |
| `fishrisk/terrain_score.py` | 요인 점수를 PRD 가중치로 합쳐 V와 기여도를 만든다 |

내려받은 원본과 중간 결과는 `pipeline/data/`, `pipeline/out/`에 두며 커밋하지 않는다(`.gitignore`).
