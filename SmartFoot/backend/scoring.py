import json
import math
import pickle
import urllib.parse
import urllib.request
from pathlib import Path

from .ml_model import FEATURE_ORDER


BASE_DIR = Path(__file__).resolve().parent.parent
MODEL_PATH = Path(__file__).resolve().parent / "model.pkl"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"


def load_model():
    with open(MODEL_PATH, "rb") as file:
        return pickle.load(file)


def predict_score(lat, lng):
    breakdown = build_breakdown(lat, lng)
    model = load_model()
    row = [[breakdown[key] for key in FEATURE_ORDER]]
    total = round(model.predict(row)[0])
    return {
        "total_score": clamp(total),
        "breakdown": breakdown,
        "legend": legend_for_score(total),
    }


def build_breakdown(lat, lng):
    osm = fetch_osm_features(lat, lng)
    cached = nearest_cached_score(lat, lng)

    road_types = osm.get("road_types", [])
    crossings = osm.get("crossings", 0)
    sidewalks = osm.get("sidewalks", 0)
    lights = osm.get("lights", 0)
    parks = osm.get("parks", 0)
    emergency = osm.get("emergency", 0)
    commercial = osm.get("commercial", 0)
    has_water = osm.get("water", 0) > 0
    road_score = classify_osm_safety(road_types, parks, has_water)

    if road_score <= 20:
        return low_score_breakdown(road_score)

    base_safety = cached.get("safety_score", 6.8) * 10
    greenery_base = cached.get("greenery_score", 5.5) * 10
    footpath_base = cached.get("footpath_score", 5.8) * 10
    lighting_base = cached.get("lighting_score", 6.2) * 10

    traffic = clamp((road_score * 0.68) + (base_safety * 0.22) + crossings * 2)
    greenery = clamp(max(road_score if parks else 0, greenery_base + parks * 10))
    sidewalk = clamp((road_score * 0.58) + (footpath_base * 0.25) + sidewalks * 10 + crossings * 2)
    air_quality = clamp((road_score * 0.45) + 42 + greenery * 0.12 - commercial * 2)
    lighting = clamp(lighting_base + lights * 6)
    emergency_access = clamp(58 + emergency * 12 + crossings * 2)
    noise = clamp((road_score * 0.55) + 35 - commercial * 2 + parks * 4)
    crowd = clamp((road_score * 0.50) + 38 - commercial * 4 + crossings * 2)

    return {
        "traffic": traffic,
        "greenery": greenery,
        "sidewalk": sidewalk,
        "air_quality": air_quality,
        "lighting": lighting,
        "emergency": emergency_access,
        "noise": noise,
        "crowd": crowd,
    }


def fetch_osm_features(lat, lng, radius=260):
    query = f"""
    [out:json][timeout:6];
    (
      way(around:{radius},{lat},{lng})["highway"];
      node(around:{radius},{lat},{lng})["highway"="crossing"];
      node(around:{radius},{lat},{lng})["highway"="street_lamp"];
      way(around:{radius},{lat},{lng})["lit"];
      way(around:{radius},{lat},{lng})["sidewalk"];
      way(around:{radius},{lat},{lng})["leisure"="park"];
      way(around:{radius},{lat},{lng})["natural"="water"];
      way(around:{radius},{lat},{lng})["waterway"];
      node(around:{radius},{lat},{lng})["waterway"];
      node(around:{radius},{lat},{lng})["amenity"~"hospital|police|clinic|pharmacy"];
      node(around:{radius},{lat},{lng})["shop"];
      way(around:{radius},{lat},{lng})["shop"];
    );
    out tags center 80;
    """
    try:
        data = urllib.parse.urlencode({"data": query}).encode("utf-8")
        request = urllib.request.Request(OVERPASS_URL, data=data, headers={"User-Agent": "SmartFoot/1.0"})
        with urllib.request.urlopen(request, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception:
        return {}

    features = {
        "road_types": [],
        "crossings": 0,
        "sidewalks": 0,
        "lights": 0,
        "parks": 0,
        "water": 0,
        "emergency": 0,
        "commercial": 0,
    }
    for element in payload.get("elements", []):
        tags = element.get("tags", {})
        highway = tags.get("highway")
        if highway and highway != "crossing" and element.get("type") == "way":
            features["road_types"].append(highway)
        if highway == "crossing":
            features["crossings"] += 1
        if highway == "street_lamp" or tags.get("lit") in {"yes", "automatic"}:
            features["lights"] += 1
        if "sidewalk" in tags and tags.get("sidewalk") not in {"no", "none"}:
            features["sidewalks"] += 1
        if tags.get("leisure") == "park":
            features["parks"] += 1
        if tags.get("natural") == "water" or "waterway" in tags:
            features["water"] += 1
        if tags.get("amenity") in {"hospital", "police", "clinic", "pharmacy"}:
            features["emergency"] += 1
        if "shop" in tags:
            features["commercial"] += 1
    return features


def classify_osm_safety(road_types, parks, has_water):
    if has_water:
        return 10

    unsafe = {"motorway", "motorway_link", "trunk", "trunk_link"}
    moderate = {"primary", "primary_link"}
    safe = {"footway", "pedestrian", "path", "living_street", "residential", "service", "cycleway"}

    if any(road in unsafe for road in road_types):
        return 15
    if any(road in moderate for road in road_types):
        return 48
    if any(road in safe for road in road_types) or parks > 0:
        return 86
    return 62


def low_score_breakdown(score):
    value = clamp(score)
    return {
        "traffic": value,
        "greenery": min(value, 20),
        "sidewalk": value,
        "air_quality": min(value + 5, 20),
        "lighting": min(value + 5, 20),
        "emergency": min(value + 5, 20),
        "noise": min(value + 5, 20),
        "crowd": value,
    }


def nearest_cached_score(lat, lng):
    path = BASE_DIR / "visakhapatnam_safety_scores.json"
    try:
        with open(path, "r", encoding="utf-8") as file:
            rows = json.load(file)
    except FileNotFoundError:
        return {}
    return min(rows, key=lambda item: haversine(lat, lng, item["lat"], item["lng"]), default={})


def legend_for_score(score):
    if score >= 80:
        return "Excellent"
    if score >= 60:
        return "Good"
    if score >= 40:
        return "Fair"
    return "Poor"


def average(values, fallback=0):
    values = list(values)
    return sum(values) / len(values) if values else fallback


def haversine(lat1, lng1, lat2, lng2):
    radius = 6371000
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lng / 2) ** 2
    )
    return 2 * radius * math.asin(math.sqrt(a))


def clamp(value):
    return int(max(0, min(100, round(value))))
