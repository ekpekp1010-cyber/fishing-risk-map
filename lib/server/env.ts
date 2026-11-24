// 서버 전용 환경 변수. 브라우저 번들에 들어가지 않도록 서버 모듈에서만 가져온다.

export class MissingEnvError extends Error {
  constructor(name: string) {
    super(`환경 변수 ${name}가 없다. .env.local에 넣는다(.env.example 참고).`);
  }
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new MissingEnvError(name);
  return v;
}
