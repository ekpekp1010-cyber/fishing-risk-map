// 미국 NWS API에서 시범 지역에 발효 중인 경보를 가져온다. User-Agent가 필수다.

import type { AlertRow } from './db-types';

const NWS_URL = 'https://api.weather.gov/alerts/active';

/** 해안 낚시에 관련된 NWS 경보 이름의 한국어 문장 */
const EVENT_KO: Record<string, string> = {
  'High Surf Advisory': '높은 파도 주의보 발효 중',
  'High Surf Warning': '높은 파도 경보 발효 중',
  'Beach Hazards Statement': '해변 위험 정보 발표 중',
  'Coastal Flood Advisory': '해안 침수 주의보 발효 중',
  'Coastal Flood Warning': '해안 침수 경보 발효 중',
  'Coastal Flood Watch': '해안 침수 감시 발효 중',
  'Small Craft Advisory': '소형 선박 주의보 발효 중',
  'Gale Warning': '강풍 경보(해상) 발효 중',
  'Storm Warning': '폭풍 경보(해상) 발효 중',
  'Hurricane Force Wind Warning': '허리케인급 강풍 경보 발효 중',
  'Wind Advisory': '강풍 주의보 발효 중',
  'High Wind Warning': '강풍 경보 발효 중',
  'Flood Watch': '홍수 감시 발효 중',
  'Flood Warning': '홍수 경보 발효 중',
  'Flash Flood Warning': '돌발 홍수 경보 발효 중',
  'Severe Thunderstorm Warning': '강한 뇌우 경보 발효 중',
  'Tsunami Warning': '지진해일 경보 발효 중',
  'Tsunami Advisory': '지진해일 주의보 발효 중',
  'Tsunami Watch': '지진해일 감시 발효 중',
  'Winter Storm Warning': '겨울 폭풍 경보 발효 중',
  'Dense Fog Advisory': '짙은 안개 주의보 발효 중',
};

export function headlineKo(event: string): string {
  return EVENT_KO[event] ?? `${event} 발효 중`;
}

interface NwsFeature {
  properties: {
    id: string;
    event: string;
    severity?: string | null;
    onset?: string | null;
    effective?: string | null;
    expires?: string | null;
    ends?: string | null;
    status?: string;
    messageType?: string;
  };
}

/** NWS GeoJSON → alerts 행. 테스트 메시지와 취소는 뺀다. 만료는 ends가 있으면 ends를 쓴다. */
export function parseAlerts(payload: { features?: NwsFeature[] }, fetchedAt: string): AlertRow[] {
  return (payload.features ?? [])
    .map((f) => f.properties)
    .filter((p) => p.status !== 'Test' && p.messageType !== 'Cancel')
    .map((p) => ({
      id: p.id,
      source: 'NWS',
      event: p.event,
      headline: headlineKo(p.event),
      severity: p.severity ?? null,
      onset: p.onset ?? p.effective ?? null,
      expires: p.ends ?? p.expires ?? null,
      fetched_at: fetchedAt,
    }));
}

export async function fetchActiveAlerts(
  point: { lat: number; lng: number },
  userAgent: string,
  now: Date = new Date(),
  fetcher: typeof fetch = fetch,
): Promise<AlertRow[]> {
  const url = `${NWS_URL}?point=${point.lat.toFixed(4)},${point.lng.toFixed(4)}`;
  const res = await fetcher(url, {
    headers: { 'User-Agent': userAgent, Accept: 'application/geo+json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`NWS ${res.status}`);
  return parseAlerts((await res.json()) as { features?: NwsFeature[] }, now.toISOString());
}
