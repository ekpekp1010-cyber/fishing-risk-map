#!/usr/bin/env node
// 2인 협업용 자동 동기화 스크립트.
//
//   node scripts/git-sync.mjs use a|b     내 브랜치(dev-a / dev-b)로 전환
//   node scripts/git-sync.mjs start       세션 시작: 팀 변경 사항 가져오기
//   node scripts/git-sync.mjs pull        main의 새 변경을 내 브랜치로 가져오기
//   node scripts/git-sync.mjs save        변경을 커밋하고 내 브랜치로 푸시
//   node scripts/git-sync.mjs ship        검사 후 내 브랜치를 main에 반영
//   node scripts/git-sync.mjs status      현재 상태 보기
//
// 옵션: --hook (Claude Code 훅에서 호출, 항상 종료 코드 0)
//       --throttle (최근 10분 안에 가져왔으면 건너뜀)
//       --no-check (ship 때 검사 생략)
//
// 원칙: 강제 푸시를 하지 않는다. 충돌이 나면 되돌리고 알린다.

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = 'main';
const DEV = { a: 'dev-a', b: 'dev-b' };
const ROLE_DOC = {
  'dev-a': 'docs/roles/developer-a-data-risk.md',
  'dev-b': 'docs/roles/developer-b-map-ui.md',
};
const THROTTLE_MS = 10 * 60 * 1000;

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const cmd = positional[0] ?? 'status';
const cmdArg = positional[1];
const HOOK = argv.includes('--hook');
const THROTTLE = argv.includes('--throttle');
const NO_CHECK = argv.includes('--no-check');

const lines = [];
const say = (msg) => lines.push(msg);

function git(args, timeout = 60_000) {
  try {
    const out = execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
    });
    return { ok: true, out: out.trim() };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() };
  }
}

const gitDir = () => {
  const r = git(['rev-parse', '--git-dir']);
  return r.ok ? resolve(ROOT, r.out) : null;
};
const hasRemote = () => git(['remote', 'get-url', 'origin']).ok;
const currentBranch = () => git(['rev-parse', '--abbrev-ref', 'HEAD']).out;
const isDirty = () => git(['status', '--porcelain']).out.length > 0;
const remoteHas = (b) => git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${b}`]).ok;
const isAncestor = (a, b) => git(['merge-base', '--is-ancestor', a, b]).ok;

function busy(dir) {
  return ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD'].some((f) =>
    existsSync(join(dir, f)),
  );
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---- 비밀 값 검사 -------------------------------------------------------

const SECRET_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /github_pat_[A-Za-z0-9_]{30,}/,
  /sbp_[a-f0-9]{30,}/,
  /sk-(?:proj-|ant-)?[A-Za-z0-9_-]{30,}/,
  /vcp_[A-Za-z0-9]{30,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /SERVICE_ROLE_KEY\s*[=:]\s*["']?[A-Za-z0-9._-]{30,}/,
];
const BLOCKED_FILE = /(^|\/)\.env(\.(?!example$)[^/]*)?$/;

function findSecrets() {
  const hits = new Set();
  const names = git(['diff', '--cached', '--name-only']).out.split('\n').filter(Boolean);
  for (const n of names) if (BLOCKED_FILE.test(n)) hits.add(n);
  const diff = git(['diff', '--cached', '-U0', '--no-color']).out;
  let file = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) file = line.slice(6);
    else if (line.startsWith('+') && SECRET_PATTERNS.some((re) => re.test(line))) hits.add(file);
  }
  return [...hits];
}

// ---- 공통 동작 -----------------------------------------------------------

/** 변경이 있으면 커밋한다. 반환: 'clean' | 'committed' | 'blocked' | 'failed' */
function commitAll(branch) {
  if (!isDirty()) return 'clean';
  git(['add', '-A']);
  const secrets = findSecrets();
  if (secrets.length > 0) {
    git(['reset', '-q']);
    say(`[git-sync] 비밀 값으로 보이는 내용이 있어 커밋하지 않았다: ${secrets.join(', ')}`);
    say('[git-sync] 해당 값을 .env.local로 옮기고 파일에서 지운 뒤 다시 저장한다.');
    return 'blocked';
  }
  const r = git(['commit', '-q', '-m', `wip(${branch}): 자동 저장 ${timestamp()}`]);
  if (!r.ok) {
    say(`[git-sync] 커밋 실패: ${r.out.split('\n')[0]}`);
    return 'failed';
  }
  return 'committed';
}

/** origin/main을 현재 브랜치에 병합한다. 반환: 'uptodate' | 'merged' | 'conflict' | 'failed' */
function mergeMain() {
  if (!remoteHas(MAIN)) return 'uptodate';
  if (isAncestor(`origin/${MAIN}`, 'HEAD')) return 'uptodate';
  const news = git(['log', '--oneline', '--no-merges', `HEAD..origin/${MAIN}`])
    .out.split('\n')
    .filter(Boolean);
  const r = git(['merge', '--no-edit', `origin/${MAIN}`]);
  if (r.ok) {
    say(`[git-sync] main의 새 변경 ${news.length}건을 가져왔다.`);
    for (const l of news.slice(0, 5)) say(`  - ${l}`);
    return 'merged';
  }
  const files = git(['diff', '--name-only', '--diff-filter=U']).out.split('\n').filter(Boolean);
  git(['merge', '--abort']);
  if (files.length > 0) {
    say(`[git-sync] main과 충돌이 나서 병합을 되돌렸다. 충돌 파일: ${files.join(', ')}`);
    say('[git-sync] CLAUDE.md의 "충돌이 났을 때" 절차를 따른다.');
    return 'conflict';
  }
  say(`[git-sync] main을 가져오지 못했다: ${r.out.split('\n')[0]}`);
  return 'failed';
}

function pushBranch(branch) {
  let r = git(['push', '-u', 'origin', branch], 90_000);
  if (r.ok) return true;
  // 같은 브랜치를 다른 기기에서 먼저 올린 경우: 받아서 다시 올린다.
  if (remoteHas(branch) || git(['fetch', 'origin', branch]).ok) {
    const rb = git(['pull', '--rebase', 'origin', branch], 90_000);
    if (!rb.ok) {
      git(['rebase', '--abort']);
      say(`[git-sync] ${branch} 푸시 실패: 원격과 내용이 갈렸다. 사용자에게 알린다.`);
      return false;
    }
    r = git(['push', '-u', 'origin', branch], 90_000);
    if (r.ok) return true;
  }
  say(`[git-sync] ${branch} 푸시 실패: ${r.out.split('\n').pop()}`);
  return false;
}

function guard() {
  const dir = gitDir();
  if (!dir) return { skip: true };
  if (busy(dir)) {
    say('[git-sync] 병합 또는 리베이스가 진행 중이다. 먼저 끝내거나 취소해야 한다.');
    return { skip: true };
  }
  return { skip: false, dir, remote: hasRemote(), branch: currentBranch() };
}

// ---- 명령 ---------------------------------------------------------------

function doPull(isStart) {
  const g = guard();
  if (g.skip) return;
  const stamp = join(g.dir, 'claude-sync-stamp');
  if (THROTTLE && existsSync(stamp) && Date.now() - statSync(stamp).mtimeMs < THROTTLE_MS) return;

  if (g.remote) {
    const f = git(['fetch', 'origin', '--prune'], 90_000);
    if (!f.ok) {
      if (isStart) say('[git-sync] 원격에 연결하지 못해 가져오기를 건너뛰었다(오프라인일 수 있음).');
      return;
    }
    writeFileSync(stamp, String(Date.now()));
  }

  if (g.branch === MAIN) {
    if (g.remote && remoteHas(MAIN) && !isDirty()) git(['merge', '--ff-only', `origin/${MAIN}`]);
    if (isStart) {
      say('[git-sync] 지금 main 브랜치다. main에서는 작업하지 않는다.');
      say('[git-sync] 사용자에게 개발자 A인지 B인지 묻고 `node scripts/git-sync.mjs use a` 또는 `use b`를 실행한다.');
    }
    return;
  }

  if (g.remote) {
    if (commitAll(g.branch) === 'blocked') return;
    if (remoteHas(g.branch) && !isAncestor(`origin/${g.branch}`, 'HEAD')) {
      const r = git(['pull', '--rebase', 'origin', g.branch], 90_000);
      if (!r.ok) {
        git(['rebase', '--abort']);
        say(`[git-sync] 원격 ${g.branch}를 가져오지 못했다. 사용자에게 알린다.`);
        return;
      }
    }
    mergeMain();
  }

  if (isStart) {
    const doc = ROLE_DOC[g.branch];
    say(`[git-sync] 현재 브랜치: ${g.branch}${doc ? ` → 역할 문서 ${doc}를 따른다.` : ''}`);
  }
}

function doSave() {
  const g = guard();
  if (g.skip) return;
  if (g.branch === MAIN) {
    if (isDirty()) say('[git-sync] main 브랜치에 커밋되지 않은 변경이 있다. dev-a 또는 dev-b로 옮겨야 한다.');
    return;
  }
  const c = commitAll(g.branch);
  if (c === 'blocked' || c === 'failed') return;
  if (!g.remote) return;
  const ahead =
    !remoteHas(g.branch) || git(['rev-list', '--count', `origin/${g.branch}..HEAD`]).out !== '0';
  if (ahead) pushBranch(g.branch);
}

function runChecks() {
  const pkgPath = join(ROOT, 'package.json');
  if (NO_CHECK || !existsSync(pkgPath)) return true;
  const scripts = JSON.parse(readFileSync(pkgPath, 'utf8')).scripts ?? {};
  const names = scripts.check ? ['check'] : ['lint', 'typecheck', 'test'].filter((n) => scripts[n]);
  for (const n of names) {
    console.log(`[git-sync] 검사 실행: npm run ${n}`);
    try {
      execSync(`npm run ${n}`, { cwd: ROOT, stdio: 'inherit' });
    } catch {
      say(`[git-sync] 검사 실패(npm run ${n}). main에 반영하지 않았다. 고친 뒤 다시 ship 한다.`);
      return false;
    }
  }
  return true;
}

function doShip() {
  const g = guard();
  if (g.skip) return false;
  if (g.branch === MAIN) {
    say('[git-sync] main에서는 ship 할 수 없다. dev-a 또는 dev-b에서 실행한다.');
    return false;
  }
  if (!g.remote) {
    say('[git-sync] 원격 저장소(origin)가 없다.');
    return false;
  }
  const c = commitAll(g.branch);
  if (c === 'blocked' || c === 'failed') return false;

  for (let attempt = 1; attempt <= 2; attempt++) {
    if (!git(['fetch', 'origin', '--prune'], 90_000).ok) {
      say('[git-sync] 원격에 연결하지 못했다.');
      return false;
    }
    const m = mergeMain();
    if (m === 'conflict' || m === 'failed') return false;
    if (attempt === 1 && !runChecks()) return false;
    if (!pushBranch(g.branch)) return false;
    const r = git(['push', 'origin', `HEAD:${MAIN}`], 90_000);
    if (r.ok) {
      say(`[git-sync] main에 반영했다: ${git(['rev-parse', '--short', 'HEAD']).out}`);
      return true;
    }
    if (attempt === 2) say(`[git-sync] main 푸시 실패: ${r.out.split('\n').pop()}`);
  }
  return false;
}

function doUse() {
  const branch = DEV[cmdArg];
  if (!branch) {
    say('[git-sync] 사용법: node scripts/git-sync.mjs use a   (또는 use b)');
    return false;
  }
  const g = guard();
  if (g.skip) return false;
  if (g.remote) git(['fetch', 'origin', '--prune'], 90_000);
  const local = git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).ok;
  let r;
  if (local) r = git(['switch', branch]);
  else if (remoteHas(branch)) r = git(['switch', '-c', branch, '--track', `origin/${branch}`]);
  else r = git(['switch', '-c', branch, remoteHas(MAIN) ? `origin/${MAIN}` : 'HEAD']);
  if (!r.ok) {
    say(`[git-sync] 브랜치 전환 실패: ${r.out.split('\n')[0]}`);
    return false;
  }
  say(`[git-sync] ${branch} 브랜치로 전환했다. 역할 문서: ${ROLE_DOC[branch]}`);
  return true;
}

function doStatus() {
  const g = guard();
  if (g.skip) {
    say('[git-sync] git 저장소가 아니거나 병합이 진행 중이다.');
    return;
  }
  say(`브랜치: ${g.branch}`);
  say(`커밋되지 않은 변경: ${isDirty() ? '있음' : '없음'}`);
  if (g.remote && remoteHas(MAIN)) {
    say(`main보다 앞선 커밋: ${git(['rev-list', '--count', `origin/${MAIN}..HEAD`]).out}`);
    say(`main보다 뒤진 커밋: ${git(['rev-list', '--count', `HEAD..origin/${MAIN}`]).out}`);
  }
}

// ---- 실행 ---------------------------------------------------------------

let ok = true;
try {
  if (cmd === 'start') doPull(true);
  else if (cmd === 'pull') doPull(false);
  else if (cmd === 'save') doSave();
  else if (cmd === 'ship') ok = doShip();
  else if (cmd === 'use') ok = doUse();
  else doStatus();
} catch (e) {
  say(`[git-sync] 예기치 않은 오류: ${e.message}`);
  ok = false;
}

if (lines.length > 0) {
  // Stop 훅의 출력은 Claude에게 가지 않으므로 사용자에게 보이는 메시지로 낸다.
  if (HOOK && cmd === 'save') console.log(JSON.stringify({ systemMessage: lines.join('\n') }));
  else console.log(lines.join('\n'));
}
process.exit(HOOK || ok ? 0 : 1);
