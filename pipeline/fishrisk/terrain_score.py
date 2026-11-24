"""지형 취약성 V: 요인별 0~100 점수를 PRD 가중치로 합쳐 0~100점과 기여도를 만든다.

요인별 0~100 점수(경사 몇 도가 몇 점인지 등)는 1단계 지표 계산에서 정한다.
이 모듈은 가중 합과 기여도 정렬만 책임진다.
"""

from __future__ import annotations

from dataclasses import dataclass

# PRD 가중치(합 100). 코드 이름은 API의 factors[].code와 같다.
WEIGHTS: dict[str, int] = {
    "slope": 20,            # 경사
    "low_elevation": 20,    # 저지대(평균해면 대비 고도)
    "flood_trace": 15,      # 침수 흔적(물 출현 빈도)
    "water_proximity": 10,  # 수변 근접
    "wave_exposure": 15,    # 파랑 노출
    "surface": 10,          # 지표 상태(피복)
    "egress": 10,           # 퇴로
}

assert sum(WEIGHTS.values()) == 100


@dataclass(frozen=True)
class FactorInput:
    code: str
    score: float  # 0~100
    label: str = ""  # 화면용 한국어 문장. 예: "급경사 암반"


@dataclass(frozen=True)
class FactorResult:
    code: str
    label: str
    score: int
    weight: int
    contribution: float  # V에 더한 점수(0~weight)

    def to_dict(self) -> dict:
        return {
            "code": self.code,
            "label": self.label,
            "score": self.score,
            "weight": self.weight,
            "contribution": round(self.contribution, 2),
        }


@dataclass(frozen=True)
class TerrainScore:
    score: int  # 0~100
    factors: list[FactorResult]  # 기여도가 큰 순서
    missing: list[str]  # 값이 없어 최악(100점)으로 본 요인


def _clamp(x: float) -> float:
    return max(0.0, min(100.0, float(x)))


def compute_terrain_score(factors: list[FactorInput]) -> TerrainScore:
    """요인 점수를 가중 합한다.

    - 알 수 없는 요인 코드는 오류로 본다.
    - 빠진 요인은 위험한 쪽으로 판정해 100점으로 넣고 `missing`에 적는다.
    """
    given: dict[str, FactorInput] = {}
    for f in factors:
        if f.code not in WEIGHTS:
            raise ValueError(f"알 수 없는 요인 코드: {f.code}")
        if f.code in given:
            raise ValueError(f"요인 코드가 중복됨: {f.code}")
        given[f.code] = f

    results: list[FactorResult] = []
    missing: list[str] = []
    for code, weight in WEIGHTS.items():
        f = given.get(code)
        if f is None:
            missing.append(code)
            s, label = 100.0, ""
        else:
            s, label = _clamp(f.score), f.label
        results.append(
            FactorResult(
                code=code,
                label=label,
                score=round(s),
                weight=weight,
                contribution=weight * s / 100.0,
            )
        )

    total = round(sum(r.contribution for r in results))
    # 기여도 내림차순, 같으면 가중치가 큰 요인이 먼저.
    results.sort(key=lambda r: (-r.contribution, -r.weight, r.code))
    return TerrainScore(score=int(max(0, min(100, total))), factors=results, missing=missing)
