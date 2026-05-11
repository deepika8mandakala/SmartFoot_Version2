import random


def predict_score(lat, lng):
    # Convert to float (safety)
    lat = float(lat)
    lng = float(lng)

    # Dummy scoring logic (replace later with ML)
    return {
        "safety": round(60 + random.uniform(-10, 10), 2),
        "greenery": round(55 + random.uniform(-10, 10), 2),
        "air": round(70 + random.uniform(-10, 10), 2),
        "sidewalk": round(65 + random.uniform(-10, 10), 2),
        "lat": lat,
        "lng": lng
    }
