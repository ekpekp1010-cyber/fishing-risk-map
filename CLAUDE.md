# CLAUDE.md

낚시 포인트 위험도 예측 3D 웹앱 저장소다. 두 사람이 각자 Claude Code로 개발하고 GitHub로 합친다.
이 파일은 두 사람의 Claude가 똑같이 따르는 협업 규칙이다.

## 1. 먼저 읽을 것

- 제품 요약과 시작 방법: `README.md`
- 내 역할과 할 일: 아래 표에서 내 브랜치에 해당하는 역할 문서
- 두 사람 사이의 약속(API, 타일, 타입): `docs/api-contract.md`

## 2. 브랜치가 곧 사람이다

| 사람 | 브랜치 | 역할 문서 |
| --- | --- | --- |
| 개발자 A (데이터·위험도 엔진) | `dev-a` | `docs/roles/developer-a-data-risk.md` |
| 개발자 B (3D 지도·UI) | `dev-b` | `docs/roles/developer-b-map-ui.md` |

- `main`에서는 직접 작업하지 않는다. `main`은 두 사람의 완성된 작업이 합쳐지는 곳이다.
- 세션 시작 메시지가 "지금 main 브랜치다"라고 하면, 사용자에게 개발자 A인지 B인지 묻고
  `node scripts/git-sync.mjs use a` 또는 `node scripts/git-sync.mjs use b`를 실행한다.
- 상대의 브랜치를 체크아웃하거나 그 브랜치에 푸시하지 않는다.

## 3. 자동 동기화

`.claude/settings.json`의 훅이 아래 동작을 자동으로 실행한다. 따로 명령할 필요가 없다.

| 시점 | 자동 동작 |
| --- | --- |
| 세션 시작 | 원격을 가져와 내 브랜치를 최신으로 만들고 `origin/main`을 병합한다 |
| 사용자 메시지 입력 (10분에 한 번) | 같은 가져오기를 다시 한다 |
| Claude 응답 종료 | 남은 변경을 `wip` 커밋으로 저장하고 내 브랜치로 푸시한다 |

`[git-sync]`로 시작하는 출력은 이 스크립트의 상태 보고다. 내용에 맞춰 이 문서의 절차를 따른다.

Claude가 직접 해야 하는 일은 두 가지다.

1. **의미 있는 커밋.** 작업 단위가 끝나면 8번 형식의 메시지로 직접 커밋한다. 자동 `wip` 커밋은 안전망일 뿐이다.
2. **main 반영.** 작업 단위가 끝나고 9번의 검증을 통과하면, 묻지 않고 `node scripts/git-sync.mjs ship`을 실행한다.
   이 명령은 `origin/main`을 병합하고, 검사를 돌리고, 내 브랜치와 `main`에 푸시한다.

`ship` 하면 안 되는 경우: 빌드가 깨져 있을 때, 만들다 만 기능이 화면에 드러날 때, 상대 소유 경로를 건드렸을 때.
이때는 내 브랜치에만 두고(자동 저장됨) 사용자에게 이유를 말한다.

## 4. 소유 경로

| 경로 | 소유 | 내용 |
| --- | --- | --- |
| `pipeline/` | A | 위성·지형 분석 파이썬 코드 |
| `supabase/` | A | DB 스키마, 마이그레이션, 시드 |
| `app/api/` | A | 위험도·추천 API (Route Handlers) |
| `lib/risk/`, `lib/server/` | A | 점수 계산, 예보 수집, DB 접근 |
| `lib/contract/` | A | 공유 타입과 예시 응답(fixtures) |
| `app/` (`app/api/` 제외) | B | 화면, 레이아웃 |
| `components/`, `styles/`, `public/` | B | UI 컴포넌트, Material 3 토큰, 정적 파일 |
| `lib/map/`, `lib/ui/`, `lib/hooks/` | B | 지도 레이어, 화면 상태 |
| `next.config.*`, `tsconfig.json`, `eslint.config.*` | B | 앱 골격 설정 |
| `docs/`, `README.md` | 공유 | 문서 |
| `package.json`, lock 파일 | 공유 | 5번 규칙을 따른다 |

내 소유가 아닌 경로는 읽기만 한다. 고쳐야 할 이유가 생기면 고치지 말고
`docs/api-contract.md`의 "요청" 섹션에 적은 뒤 사용자에게 알린다.

## 5. 공유 파일 규칙

- **의존성 추가.** `package.json`을 바꾸기 전에 `node scripts/git-sync.mjs pull`을 실행한다.
  설치 후에는 그 변경만 따로 커밋하고 바로 `ship` 한다. 다른 작업과 한 커밋에 섞지 않는다.
- **`docs/api-contract.md`.** 본문은 A가 고친다. B는 "요청" 섹션에만 추가한다.
- **`lib/contract/`.** 필드를 추가하는 것은 자유다. 필드를 지우거나 이름을 바꾸려면 먼저 계약 문서에 적고 B가 확인한 뒤에 한다.
- **협업 도구.** `CLAUDE.md`, `scripts/git-sync.mjs`, `.claude/settings.json`, `.gitignore`는 두 사람이 합의한 뒤에만 고친다. Claude가 스스로 판단해 고치지 않는다.

## 6. 충돌이 났을 때

훅은 충돌이 나면 병합을 되돌려 두므로 작업 내용은 그대로다. 다음 순서로 해결한다.

1. `git merge origin/main`을 다시 실행해 충돌 파일을 확인한다.
2. 파일 종류에 따라 해결한다.
   - 내 소유 경로: 내 의도를 유지하며 직접 해결한다.
   - 상대 소유 경로: `main` 쪽 내용을 그대로 받는다(`git checkout --theirs <파일>`).
   - 공유 문서: 양쪽 변경을 모두 살린다.
   - lock 파일: `main` 쪽을 받은 뒤 `npm install`로 다시 만든다.
3. 9번의 검증을 돌리고 커밋한 뒤 `ship` 한다.
4. 어느 쪽이 맞는지 판단이 서지 않으면 `git merge --abort`로 되돌리고 사용자에게 상황을 설명한다.

## 7. 하지 않는 것

- `git push --force`, 원격에 올라간 커밋에 대한 `git reset --hard`, 브랜치 삭제, `main` 직접 커밋.
- `.env`, 토큰, API 키 커밋. 비밀 값은 `.env.local`에만 두고 이름만 `.env.example`에 적는다.
- `ai 바이브 코딩.txt` 읽기, 인용, 커밋. 개인 메모이며 비밀 값이 들어 있다.
- `*.fig`, 위성 원본 데이터, 타일 파일(`*.tif`, `*.pmtiles`) 커밋.
- 훅을 끄거나 우회하기.

## 8. 커밋 메시지

`<종류>(<영역>): <한국어 요약>` 형식을 쓴다. 종류는 `feat`, `fix`, `docs`, `refactor`, `test`, `chore` 중 하나다.

```
feat(risk): 시간대 위험요인 점수 계산 추가
fix(map): 시간 슬라이더를 움직여도 구역 색이 안 바뀌던 문제 수정
```

## 9. 검증

- 웹 코드: `npm run lint`, `npm run typecheck`, `npm run build`가 통과해야 한다.
  `ship`은 `lint`, `typecheck`, `test` 중 있는 것을 자동 실행한다(`check` 스크립트가 있으면 그것만 실행).
- 파이프라인: `pytest pipeline/tests`가 통과해야 한다.
- 화면을 바꿨으면 브라우저에서 직접 열어 동작을 확인한다.

## 10. 기술 기준

Next.js(App Router) + TypeScript, MapLibre GL JS + deck.gl, Supabase(Postgres + PostGIS),
Python 배치 파이프라인, Open-Meteo, Material 3. 시범 지역은 미국 오리건주 뉴포트 해안이다.
다른 기술로 바꾸려면 두 사람이 먼저 합의한다.
