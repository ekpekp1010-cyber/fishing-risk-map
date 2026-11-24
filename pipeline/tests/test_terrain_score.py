import pytest

from fishrisk.terrain_score import WEIGHTS, FactorInput, compute_terrain_score


def all_factors(score: float) -> list[FactorInput]:
    return [FactorInput(code=c, score=score) for c in WEIGHTS]


def test_weights_sum_to_100():
    assert sum(WEIGHTS.values()) == 100


@pytest.mark.parametrize("value,expected", [(0, 0), (50, 50), (100, 100)])
def test_uniform_scores(value, expected):
    assert compute_terrain_score(all_factors(value)).score == expected


def test_score_is_clamped_to_0_100():
    assert compute_terrain_score(all_factors(250)).score == 100
    assert compute_terrain_score(all_factors(-30)).score == 0


def test_weighted_sum():
    factors = all_factors(0)
    factors[0] = FactorInput(code="slope", score=80, label="급경사 암반")  # 20 * 0.8 = 16
    factors[1] = FactorInput(code="low_elevation", score=70)  # 20 * 0.7 = 14
    result = compute_terrain_score(factors)
    assert result.score == 30
    assert [f.code for f in result.factors[:2]] == ["slope", "low_elevation"]
    assert result.factors[0].label == "급경사 암반"
    assert result.factors[0].contribution == pytest.approx(16)


def test_missing_factor_is_treated_as_worst():
    factors = [f for f in all_factors(0) if f.code != "wave_exposure"]
    result = compute_terrain_score(factors)
    assert result.missing == ["wave_exposure"]
    assert result.score == WEIGHTS["wave_exposure"]


def test_unknown_or_duplicate_code_raises():
    with pytest.raises(ValueError):
        compute_terrain_score([FactorInput(code="nope", score=10)])
    with pytest.raises(ValueError):
        compute_terrain_score([FactorInput(code="slope", score=10), FactorInput(code="slope", score=20)])


def test_factor_dict_shape():
    d = compute_terrain_score(all_factors(40)).factors[0].to_dict()
    assert set(d) == {"code", "label", "score", "weight", "contribution"}
