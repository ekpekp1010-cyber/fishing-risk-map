from fishrisk.config import AOI, cell_id, is_excluded


def test_cell_id_snaps_to_005_grid():
    assert cell_id(44.6131, -124.0712) == "44.60_-124.05"
    assert cell_id(44.6302, -124.0521) == "44.65_-124.05"


def test_cell_id_half_rounds_up():
    assert cell_id(44.625, -124.075) == "44.65_-124.05"


def test_cell_id_has_no_negative_zero():
    assert cell_id(0.001, -0.001) == "0.00_0.00"


def test_aoi_corners_map_to_seeded_cells():
    seeded = {f"{lat:.2f}_{lng:.2f}" for lat in (44.60, 44.65, 44.70) for lng in (-124.10, -124.05, -124.00)}
    for lat in (AOI.south, AOI.north):
        for lng in (AOI.west, AOI.east):
            assert cell_id(lat, lng) in seeded


def test_yaquina_head_is_excluded():
    assert is_excluded(44.677, -124.078) == "yaquina-head"
    assert is_excluded(44.6131, -124.0712) is None
