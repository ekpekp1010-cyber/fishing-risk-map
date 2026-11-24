# 게이트 2 결과: 과거 사고 재계산

실행: 2026-11-24T10:56:39.920Z · 계산식: lib/risk (운영과 같음) · 판정: 사고 시각 등급이 caution 이상이면 재현

**재현 5/6 (83%) → 통과** (기준 80%). 경보를 빼고 계산하면 5/6.

| 사고 | 시각(UTC) | 시각 확실성 | V | 등급(경보 포함) | R | 경보 빼면 | 파고 | 주기 | 돌풍 | 조위 | 발효 경보 | 원인 상위 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 뉴포트 사우스 제티 끝 | 2010-11-10T21 | approx | 72 | danger | 99 | danger 99 | 3.7 m | 14.2 s | 3 m/s | 0.977 m | 없음 | 포인트·퇴로가 물에 잠길 수 있음 / 너울 처오름 약 1.5 m(주기 14초), 파도가 포인트·퇴로까지 밀려 올라올 수 있음 / 너울 주기 14초, 파고 3.7 m |
| 야하츠 스멜트 샌즈 북쪽 암반 | 2011-02-05T22 | day_only | 47 | caution | 46 | caution 46 | 2.36 m | 12.6 s | 4.1 m/s | 0.891 m | 없음 | 물가까지 약 15 m / 암반 지표 / 외해로 열린 곳 |
| 디포베이 방파벽 앞 암반(스파우팅 혼) | 2018-01-18T19 | reported | 59 | danger | 94 | danger 94 | 7.22 m | 16.45 s | 16.7 m/s | 1.419 m | Coastal Flood Warning | 포인트·퇴로가 물에 잠길 수 있음 / 너울 처오름 약 1.9 m(주기 16초), 파도가 포인트·퇴로까지 밀려 올라올 수 있음 / 유의파고 7.2 m (외해 기준, 이곳은 파랑이 줄어듦) |
| 오터 크레스트 루프 남쪽 암반(로키 크리크) | 2018-09-10T00 | reported | 54 | safe | 39 | safe 39 | 1.78 m | 9.35 s | 9.8 m/s | -0.481 m | 없음 | 물가까지 약 15 m / 암반 지표 / 외해로 열린 곳 |
| 오터 크레스트 루프 북쪽 암반(낚시 중) | 2025-01-15T22 | reported | 60 | caution | 52 | caution 52 | 2.38 m | 11.3 s | 4.7 m/s | 1.106 m | 없음 | 외해로 열린 곳 / 물가까지 약 15 m / 암반 지표 |
| 링컨시티 실레츠만 입구 해변 | 2025-10-19T22 | afternoon_only | 48 | danger | 42 | caution 42 | 4.68 m | 10.4 s | 11.7 m/s | 0.088 m | Beach Hazard Statement, Beach Hazard Statement | 물가까지 약 15 m / 평균해면보다 2.5 m 높음 / 풍속 5 m/s, 돌풍 12 m/s |

시간대 창(불확실한 시각) 안의 등급:

- newport-south-jetty-2010: 20시 danger, 21시 danger, 22시 danger
- yachats-smelt-sands-2011: 17시 caution, 18시 caution, 19시 caution, 20시 caution, 21시 caution, 22시 caution, 23시 caution, 00시 caution, 01시 caution, 02시 caution, 03시 caution
- depoe-bay-seawall-2018: 18시 danger, 19시 danger, 20시 danger
- otter-crest-2018: 23시 safe, 00시 safe, 01시 safe
- otter-crest-2025: 21시 caution, 22시 caution, 23시 caution
- siletz-bay-2025: 19시 danger, 20시 danger, 21시 danger, 22시 danger, 23시 danger, 00시 danger, 01시 danger

파랑 자료: ERA5 해양 (44.5, -124.5) · ERA5 해양 (45, -124.5) · Open-Meteo Marine (44.791664, -124.04166) · Open-Meteo Marine (44.958336, -124.12499)
