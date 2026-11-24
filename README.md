# 낚시 포인트 위험도 예측 3D 웹앱

위성·지형 데이터로 낚시 포인트 주변의 고정된 취약성을 계산하고, 기상·수위·해양 예보로 시간대별 위험을 더해,
포인트마다 안전·주의·위험과 그 원인을 3D 지도에 보여 주는 웹앱이다.

- 시범 지역: 미국 오리건주 뉴포트 해안(야퀴나 헤드 ~ 사우스 비치, 약 9 km)
- MVP 순서: 환경 분석 → 위험도 표시 → 3D 지도 → 장소 추천
- 전체 PRD: https://claude.ai/artifact/TtYmwWbfyzkzx5Dz6rmUF4 (작성자가 공유해야 열린다)

## 두 사람의 역할

| 사람 | 브랜치 | 맡는 일 | 문서 |
| --- | --- | --- | --- |
| 개발자 A | `dev-a` | 위성·지형 분석, DB, 예보 수집, 위험도·추천 API | [역할 계획](docs/roles/developer-a-data-risk.md) |
| 개발자 B | `dev-b` | 3D 지도, 화면, Material 3 디자인 | [역할 계획](docs/roles/developer-b-map-ui.md) |

두 사람 사이의 약속(API 모양, 타일 주소)은 [docs/api-contract.md](docs/api-contract.md)에 있다.

## 처음 시작할 때

필요한 것: Git, Node.js 24 이상, Claude Code. 개발자 A는 Python 3.11 이상도 필요하다.

1. 저장소를 받는다.

   ```bash
   git clone https://github.com/ekpekp1010-cyber/fishing-risk-map.git
   ```

2. 받은 폴더에서 내 브랜치로 바꾼다. 개발자 A는 `a`, 개발자 B는 `b`.

   ```bash
   node scripts/git-sync.mjs use a
   ```

3. 그 폴더에서 Claude Code를 연다. 처음 열 때 이 저장소의 훅을 신뢰할지 묻는다. 허용해야 자동 동기화가 동작한다.
4. Claude에게 "내 역할 문서의 다음 단계를 진행해줘"라고 말한다.

## 자동 동기화가 하는 일

직접 `git pull`, `git push`를 할 필요가 없다.

| 시점 | 자동 동작 |
| --- | --- |
| Claude 세션 시작 | 상대가 `main`에 올린 변경을 내 브랜치로 가져온다 |
| 메시지를 보낼 때 (10분에 한 번) | 같은 가져오기를 다시 한다 |
| Claude가 답을 마칠 때 | 내 변경을 커밋하고 내 브랜치(`dev-a` 또는 `dev-b`)로 푸시한다 |
| 작업 단위가 끝났을 때 | Claude가 검사를 돌린 뒤 `main`에 합친다 |

- 각자 자기 브랜치에만 자동 푸시하므로 푸시끼리 부딪히지 않는다.
- 각자 자기 폴더만 고치므로(`CLAUDE.md` 4번) 합칠 때 충돌이 드물다.
- 충돌이 나면 스크립트가 병합을 되돌리고 Claude가 정해진 절차로 해결한다. 강제 푸시는 하지 않는다.
- 토큰이나 `.env` 파일이 섞이면 스크립트가 커밋을 멈추고 알린다.

직접 실행할 수 있는 명령:

```bash
node scripts/git-sync.mjs status   # 지금 상태
node scripts/git-sync.mjs pull     # 지금 바로 가져오기
node scripts/git-sync.mjs save     # 지금 바로 저장하고 푸시
node scripts/git-sync.mjs ship     # 검사 후 main에 합치기
```

## 저장소에 넣지 않는 것

- 비밀 값: `.env`, `.env.local`, 토큰이 든 메모. 변수 이름만 `.env.example`에 적는다.
- 디자인 원본 `Material 3 Design Kit (Community).fig`(57 MB). Figma에서 공유한다.
- 위성 원본과 타일 파일(`*.tif`, `*.pmtiles`). Supabase Storage에 둔다.

## 기술 스택

Next.js(App Router) + TypeScript, MapLibre GL JS + deck.gl, Supabase(Postgres + PostGIS),
Python 배치 파이프라인, Open-Meteo, Material 3.
