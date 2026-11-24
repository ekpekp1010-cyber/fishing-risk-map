"""lib/contract/fixtures/의 예시 응답이 docs/api-contract.md 규칙을 지키는지 검사한다."""

import json
from datetime import datetime, timedelta
from pathlib import Path

import pytest

FIXTURES = Path(__file__).resolve().parents[2] / "lib" / "contract" / "fixtures"

GRADES = {"safe", "caution", "danger"}
CONFIDENCE = {"high", "medium", "low"}
SPOT_TYPES = {"jetty", "pier", "rocks", "beach", "estuary"}
FLOOD = {"high", "medium", "low"}


def load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def grade_of(score: int) -> str:
    return "safe" if score <= 39 else "caution" if score <= 69 else "danger"


def assert_hour(value: str) -> None:
    t = ts(value)
    assert value.endswith("Z") and t.minute == 0 and t.second == 0, value


def assert_score(score) -> None:
    assert isinstance(score, int) and 0 <= score <= 100, score


@pytest.mark.parametrize("name", ["spots.json", "spots-empty.json"])
def test_spots(name):
    data = load(name)
    assert_hour(data["time"])
    for s in data["spots"]:
        assert s["type"] in SPOT_TYPES and s["confidence"] in CONFIDENCE
        assert_score(s["score"])
        assert s["grade"] == grade_of(s["score"])


@pytest.mark.parametrize("name", ["spot-risk.json", "spot-risk-stale.json"])
def test_spot_risk(name):
    data = load(name)
    assert data["spot"]["type"] in SPOT_TYPES
    assert data["confidence"] in CONFIDENCE
    terrain = data["terrain"]
    assert_score(terrain["score"])
    assert terrain["floodFrequency"] in FLOOD
    for f in terrain["factors"]:
        assert_score(f["score"])

    expiries = [ts(a["expires"]) for a in data["alerts"]]
    for h in data["hourly"]:
        assert_hour(h["time"])
        assert_score(h["score"])
        assert 0 < len(h["causes"]) <= 3
        under_alert = any(ts(h["time"]) < e for e in expiries)
        assert h["grade"] == ("danger" if under_alert else grade_of(h["score"]))

    first = ts(data["hourly"][0]["time"])
    age = first - ts(data["forecastFetchedAt"])
    assert data["stale"] == (age > timedelta(hours=6))


def test_zone_grades():
    data = load("zone-grades.json")
    assert_hour(data["time"])
    assert set(data["grades"].values()) <= GRADES


@pytest.mark.parametrize("name", ["recommendations.json", "recommendations-empty.json"])
def test_recommendations(name):
    data = load(name)
    assert_hour(data["time"])
    assert len(data["items"]) <= 5
    for item in data["items"]:
        assert item["grade"] != "danger"
        assert item["grade"] == grade_of(item["score"])
        assert item["walkMinutes"] >= 0 and item["reason"]


def test_required_cases_are_covered():
    """계약: 세 등급, stale true, alerts 있음, 빈 목록을 각각 하나 이상 포함한다."""
    grades = {s["grade"] for s in load("spots.json")["spots"]}
    assert grades == GRADES
    risks = [load("spot-risk.json"), load("spot-risk-stale.json")]
    assert any(r["stale"] for r in risks)
    assert any(r["alerts"] for r in risks)
    assert load("spots-empty.json")["spots"] == []
    assert load("recommendations-empty.json")["items"] == []
