from fishrisk.config import AOI
from fishrisk.osm import build_query, classify, parse, to_geojson


def test_classify():
    assert classify({"man_made": "breakwater"}) == "jetty"
    assert classify({"man_made": "pier"}) == "pier"
    assert classify({"natural": "beach"}) == "beach"
    assert classify({"natural": "bare_rock"}) == "rocks"
    assert classify({"wetland": "tidalflat"}) == "estuary"
    assert classify({"amenity": "parking"}) == "parking"
    assert classify({"leisure": "fishing"}) == "unknown"
    assert classify({"highway": "residential"}) is None


def test_query_uses_aoi_in_overpass_order():
    assert f"({AOI.south},{AOI.west},{AOI.north},{AOI.east})" in build_query()


def test_parse_filters_dedups_and_flags_exclusions():
    payload = {
        "elements": [
            {"type": "way", "id": 1, "center": {"lat": 44.6131, "lon": -124.0712}, "tags": {"man_made": "breakwater", "name": "South Jetty"}},
            {"type": "way", "id": 1, "center": {"lat": 44.6131, "lon": -124.0712}, "tags": {"man_made": "breakwater"}},
            {"type": "node", "id": 2, "lat": 44.677, "lon": -124.078, "tags": {"natural": "bare_rock"}},
            {"type": "node", "id": 3, "lat": 45.5, "lon": -124.0, "tags": {"natural": "beach"}},  # 범위 밖
            {"type": "node", "id": 4, "lat": 44.62, "lon": -124.05, "tags": {"highway": "bus_stop"}},  # 관심 없음
            {"type": "way", "id": 5, "tags": {"natural": "beach"}},  # 좌표 없음
        ]
    }
    cands = parse(payload)
    assert [c.osm_id for c in cands] == ["way/1", "node/2"]
    jetty, rock = cands
    assert jetty.kind == "jetty" and jetty.name == "South Jetty" and jetty.excluded is None
    assert rock.kind == "rocks" and rock.excluded == "yaquina-head"


def test_geojson_shape():
    payload = {"elements": [{"type": "node", "id": 9, "lat": 44.63, "lon": -124.05, "tags": {"man_made": "pier"}}]}
    gj = to_geojson(parse(payload))
    f = gj["features"][0]
    assert f["geometry"] == {"type": "Point", "coordinates": [-124.05, 44.63]}
    assert f["properties"]["kind"] == "pier" and "lat" not in f["properties"]
