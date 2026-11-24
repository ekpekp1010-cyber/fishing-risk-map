"""1단계 1번(이어서): OSM 후보에서 낚시 포인트 초안을 고르고 사람이 검수할 표를 만든다.

    python -m fishrisk.spots          # pipeline/ 에서 실행. review/spots_draft.csv 생성

규칙(사람 검수 전 초안):
- 제외 구역(야퀴나 헤드)과 주차장은 뺀다.
- 부두: 계류용 부잔교(floating), 출입 금지, 기관 전용(NOAA·OSU·해안경비대), 30 m 미만 무명 부두는 뺀다.
  이름에 Crab·Fishing이 들어간 부잔교는 게잡이·낚시용이라 남긴다.
- 방파제: 0.5 km 이상이면 입구·중간·끝 세 곳, 짧으면 중간 한 곳. 0.1 km 미만 돌제(groyne)는 뺀다.
- 해변: 남북 1 km 이상이면 약 800 m 간격으로 바다 쪽 가장자리에 하나씩, 작으면 중심 하나.
- 하구 갯벌: 중심 하나.
- 보트 경사로(slipway)는 낚시 포인트가 아니라서 뺀다.
- 100 m 안에 이미 고른 포인트가 있으면 뺀다(이름 있는 것 우선).
검수 표의 keep 열을 no로 바꾸면 DB 적재에서 빠진다.
"""

from __future__ import annotations

import csv
import json
import math
import re
import sys
from dataclasses import dataclass
from pathlib import Path

from .config import cell_id
from .osm import OUT_DIR, Candidate, parse

ROOT = Path(__file__).resolve().parents[1]
REVIEW = ROOT / "review" / "spots_draft.csv"

DEDUP_M = 100
BEACH_STEP_DEG = 0.007  # 약 780 m

NAME_KO = {
    "North Jetty": "노스 제티",
    "South Jetty": "사우스 제티",
    "South Beach": "사우스 비치",
    "Nye Beach": "나이 비치",
    "Agate Beach": "아게이트 비치",
    "Port Dock One": "포트 독 원",
    "Abbey Street Pier": "애비 스트리트 부두",
    "Baystreet Pier": "베이 스트리트 부두",
    "Embarcadero Crab Dock": "엠바카데로 게잡이 부두",
    "King Slough": "킹 슬로 하구",
}

# 이름 없는 포인트의 지역 이름: 가장 가까운 기준점
ANCHORS = [
    ("agate", "아게이트", 44.664, -124.061),
    ("nye", "나이 비치", 44.640, -124.064),
    ("bayfront", "베이프런트", 44.627, -124.054),
    ("embarcadero", "엠바카데로", 44.629, -124.040),
    ("southbeach", "사우스 비치", 44.603, -124.067),
    ("marina", "사우스 비치 마리나", 44.622, -124.052),
    ("idaho", "아이다호 플랫", 44.619, -124.042),
    ("upriver", "야퀴나만 상류", 44.620, -124.025),
]

TYPE_KO = {"jetty": "방파제", "pier": "부두", "rocks": "갯바위", "beach": "해변", "estuary": "하구 갯벌"}
# 이름 없는 포인트 id의 유형 단어(이름 있는 포인트 id와 겹치지 않게 다른 단어를 쓴다)
TYPE_ID = {"jetty": "breakwater", "pier": "dock", "rocks": "rock", "beach": "shore", "estuary": "flat"}
TYPE_ORDER = {"jetty": 0, "pier": 1, "beach": 2, "estuary": 3, "rocks": 4}
INSTITUTIONAL = re.compile(r"NOAA|OSU|MLB|Coast Guard|Moorage|Dock [A-Z]\b", re.I)


@dataclass
class DraftSpot:
    id: str
    name: str
    type: str
    lat: float
    lng: float
    osm_id: str
    source_name: str
    keep: str = "yes"
    note: str = ""
    sample_check: str = ""  # 표본 대조 결과: "", "match", "mismatch" (검수 화면에서 기록)

    @property
    def cell(self) -> str:
        return cell_id(self.lat, self.lng)


def meters(a: tuple[float, float], b: tuple[float, float]) -> float:
    k = math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot((a[0] - b[0]) * 111_320, (a[1] - b[1]) * 111_320 * k)


def line_length_m(g) -> float:
    return sum(meters(a, b) for a, b in zip(g, g[1:]))


def point_along(g, frac: float) -> tuple[float, float]:
    """선 위에서 길이 비율 frac 지점."""
    total = line_length_m(g)
    target, acc = total * frac, 0.0
    for a, b in zip(g, g[1:]):
        seg = meters(a, b)
        if acc + seg >= target and seg > 0:
            t = (target - acc) / seg
            return a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
        acc += seg
    return g[-1]


def anchor_of(lat: float, lng: float) -> tuple[str, str]:
    key, ko, _, _ = min(ANCHORS, key=lambda a: meters((lat, lng), (a[2], a[3])))
    return key, ko


def pier_reason_to_drop(c: Candidate) -> str | None:
    t = c.tags
    if t.get("access") in ("private", "no"):
        return "출입 금지"
    if c.name and INSTITUTIONAL.search(c.name):
        return "기관 전용·계류용"
    if t.get("operator", "").startswith("Oregon State University"):
        return "기관 전용"
    if t.get("floating") == "yes" and not re.search(r"crab|fish", c.name, re.I):
        return "계류용 부잔교"
    if not c.name and line_length_m(c.geometry) < 30:
        return "30 m 미만 무명 부두"
    return None


def points_for(c: Candidate) -> list[tuple[tuple[float, float], str]]:
    """후보 하나에서 포인트 위치들과 위치 설명."""
    g = list(c.geometry)
    if c.kind == "jetty":
        if len(g) < 2:
            return [((c.lat, c.lng), "")]
        length = line_length_m(g)
        if c.tags.get("man_made") == "groyne" and length < 100:
            return []
        # 동쪽(육지) 끝에서 시작하도록 정렬해 입구→끝 순서를 맞춘다.
        if g[0][1] < g[-1][1]:
            g.reverse()
        if length >= 500:
            return [(point_along(g, 0.15), "입구"), (point_along(g, 0.5), "중간"), (point_along(g, 0.9), "끝")]
        return [(point_along(g, 0.5), "")]
    if c.kind == "beach" and g:
        lats = [p[0] for p in g]
        if max(lats) - min(lats) < 0.009:
            return [((c.lat, c.lng), "")]
        out = []
        lat = min(lats) + BEACH_STEP_DEG / 2
        while lat < max(lats):
            band = [p for p in g if abs(p[0] - lat) < BEACH_STEP_DEG / 2]
            if band:
                out.append((min(band, key=lambda p: p[1]), ""))  # 가장 서쪽(바다 쪽) 꼭짓점
            lat += BEACH_STEP_DEG
        return out
    return [((c.lat, c.lng), "")]


def build(cands: list[Candidate]) -> tuple[list[DraftSpot], list[tuple[Candidate, str]]]:
    dropped: list[tuple[Candidate, str]] = []
    pool: list[tuple[Candidate, tuple[float, float], str]] = []
    for c in cands:
        if c.kind == "parking":
            continue
        if c.excluded:
            dropped.append((c, f"제외 구역({c.excluded})"))
            continue
        if c.kind == "unknown":
            dropped.append((c, "보트 경사로·용도 불명"))
            continue
        if c.kind == "pier" and (why := pier_reason_to_drop(c)):
            dropped.append((c, why))
            continue
        pts = points_for(c)
        if not pts:
            dropped.append((c, "짧은 돌제"))
        pool.extend((c, p, where) for p, where in pts)

    # 이름 있는 것 → 유형 순서 → 북쪽부터
    pool.sort(key=lambda x: (x[0].name == "", TYPE_ORDER[x[0].kind], -x[1][0]))
    chosen: list[DraftSpot] = []
    used_ids: set[str] = set()
    used_names: set[str] = set()

    def unique(base: str, used: set[str], fmt) -> str:
        if base not in used:
            used.add(base)
            return base
        n = 2
        while fmt(base, n) in used:
            n += 1
        used.add(fmt(base, n))
        return fmt(base, n)

    for c, (lat, lng), where in pool:
        if any(meters((lat, lng), (s.lat, s.lng)) < DEDUP_M for s in chosen):
            continue
        suffix = {"입구": "root", "중간": "mid", "끝": "tip"}.get(where, "")
        if c.name:
            base_ko = NAME_KO.get(c.name, c.name)
            base_id = re.sub(r"[^a-z0-9]+", "-", c.name.lower()).strip("-")
        else:
            akey, ako = anchor_of(lat, lng)
            base_ko = f"{ako} {TYPE_KO[c.kind]}"
            base_id = f"{akey}-{TYPE_ID[c.kind]}"
        sid = unique(f"{base_id}-{suffix}" if suffix else base_id, used_ids, lambda b, n: f"{b}-{n:02d}")
        name = unique(f"{base_ko} {where}".strip(), used_names, lambda b, n: f"{b} {n}")
        chosen.append(DraftSpot(sid, name, c.kind, round(lat, 6), round(lng, 6), c.osm_id, c.name))

    chosen.sort(key=lambda s: -s.lat)
    return chosen, dropped


def write_review(spots: list[DraftSpot], path: Path = REVIEW) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id", "name", "type", "lat", "lng", "forecast_cell", "osm_id", "osm_name", "keep", "note", "sample_check"])
        for s in spots:
            w.writerow([s.id, s.name, s.type, s.lat, s.lng, s.cell, s.osm_id, s.source_name, s.keep, s.note, s.sample_check])


def read_review(path: Path = REVIEW) -> list[DraftSpot]:
    with open(path, encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    return [
        DraftSpot(
            r["id"], r["name"], r["type"], float(r["lat"]), float(r["lng"]),
            r.get("osm_id", ""), r.get("osm_name", ""), r.get("keep", "yes"), r.get("note", ""), r.get("sample_check", ""),
        )
        for r in rows
    ]


def main(argv: list[str]) -> int:
    raw = json.loads((OUT_DIR / "osm_raw.json").read_text(encoding="utf-8"))
    spots, dropped = build(parse(raw))
    if REVIEW.exists() and "--force" not in argv:
        # 사람이 고친 keep·note·이름을 지키기 위해 덮어쓰지 않는다.
        print(f"{REVIEW} 가 이미 있다. 다시 만들려면 --force")
        return 1
    write_review(spots)
    by_type: dict[str, int] = {}
    for s in spots:
        by_type[s.type] = by_type.get(s.type, 0) + 1
    print(f"포인트 초안 {len(spots)}곳 → {REVIEW.relative_to(ROOT)}")
    print("유형별:", ", ".join(f"{TYPE_KO[k]} {v}" for k, v in sorted(by_type.items())))
    reasons: dict[str, int] = {}
    for _, why in dropped:
        reasons[why] = reasons.get(why, 0) + 1
    print("뺀 후보:", ", ".join(f"{k} {v}" for k, v in sorted(reasons.items(), key=lambda x: -x[1])))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
