# SmartFoot

SmartFoot is a pedestrian-first route planning and walkability analysis system. It helps people choose safer, more comfortable walking routes by combining open geospatial data, route recommendations, live navigation, and machine-learning-based safety scoring.

## Project Overview

Walking routes are often optimized only for distance or travel time. That is not enough for pedestrians. A short route can still be unsafe, poorly lit, noisy, crowded, or hostile to walking because of missing sidewalks, traffic exposure, weak crossings, or lack of nearby support infrastructure.

SmartFoot addresses this gap by evaluating routes through a pedestrian safety and walkability lens.

## Solution

SmartFoot provides:

- AI-based walkability and safety analysis
- Route recommendations for A-to-B walking routes
- Circular walk planning for fitness and local exploration
- Real-time GPS navigation with destination-distance checks
- Context-aware search suggestions for walk-friendly places
- Street-level preview support through Mapillary

The system prioritizes route quality, not just shortest-path routing.

## Tech Stack

**Frontend**

- Leaflet.js
- JavaScript
- HTML/CSS

**Backend**

- Flask

**Geospatial APIs**

- OpenStreetMap tiles
- Nominatim search and reverse geocoding
- OSRM walking routes
- Mapillary street-level imagery
- Overpass/OpenStreetMap feature signals for scoring

**Machine Learning**

- Lightweight RandomForest-style model
- Model artifact: `backend/model.pkl`
- Training script: `backend/train_model.py`

## Why Not Google Maps

SmartFoot intentionally uses an open-source geospatial stack instead of Google Maps because:

- Google Maps APIs can become expensive as usage grows.
- Rate limits and billing requirements are restrictive for student and civic-tech projects.
- Route scoring and safety overlays are harder to customize in a closed ecosystem.
- OpenStreetMap allows deeper access to pedestrian-relevant map tags such as sidewalks, crossings, parks, footways, and lighting.

This makes the project easier to run, extend, audit, and demonstrate without paid API dependencies.

## How SmartFoot Is Different

- Safety-based routing instead of distance-only routing
- Walkability scoring using traffic, greenery, sidewalks, lighting, air quality, emergency access, noise, and crowd density
- AI/ML scoring layer for overall route quality
- Context-aware recommendations for parks, lakes, promenades, trails, and pedestrian-friendly areas
- Real-time GPS navigation that only marks arrival when the user is within 20 meters of the destination

## Features

- Interactive Leaflet map
- Smart autocomplete with Nominatim and walk-friendly recommendations
- Reverse geocoded current location
- A-to-B walking route planning
- Multiple route options
- Distance and realistic walking duration
- Circular walk planning by desired duration
- Live GPS navigation
- Destination detection using Haversine distance
- Mapillary street-level preview with fallback messaging
- Walkability scoring dashboard
- Machine-learning-backed `/predict-score` endpoint

## Flow Diagram

```text
User
  |
  v
Search / Current Location
  |
  v
Nominatim + Walk-Friendly Recommendations
  |
  v
OSRM Route Options
  |
  v
Safety + Walkability Score
  |
  v
Route Selection
  |
  v
Live GPS Navigation
```

Short form:

```text
User -> Search -> Route -> Score -> Navigate
```

## Screenshots

Add screenshots to a `docs/screenshots/` folder and update these paths:

### Map View

![Map view](docs/screenshots/map-view.png)

### Route Selection

![Route selection](docs/screenshots/route-selection.png)

### Live Navigation

![Live navigation](docs/screenshots/navigation.png)

### Scoring Dashboard

![Scoring dashboard](docs/screenshots/scoring-dashboard.png)

## Installation

1. Clone the repository:

```bash
git clone https://github.com/deepika8mandakala/SmartFoot.git
cd SmartFoot
git checkout leaflet-migration-clean
```

2. Create or activate a Python environment:

```bash
python -m venv venv
```

Windows:

```bash
venv\Scripts\activate
```

macOS/Linux:

```bash
source venv/bin/activate
```

3. Install dependencies:

```bash
pip install -r requirements.txt
```

4. Train or refresh the lightweight ML model:

```bash
python backend/train_model.py
```

5. Run Flask:

```bash
python app.py
```

6. Open the app:

```text
http://127.0.0.1:5000/safe-route.html
```

## Mapillary Setup

Mapillary imagery lookup requires a Mapillary access token for embedded image search. Add it before `static/map.js` is loaded if you want full street-level embed support:

```html
<script>
  window.MAPILLARY_ACCESS_TOKEN = "YOUR_MAPILLARY_TOKEN";
</script>
```

If no token or no imagery is available, SmartFoot shows:

```text
Street view not available for this location
```

## API Endpoints

### `GET /predict-score`

Query:

```text
/predict-score?lat=17.7194&lng=83.3118
```

Response:

```json
{
  "total_score": 76,
  "breakdown": {
    "traffic": 72,
    "greenery": 80,
    "sidewalk": 70,
    "air_quality": 78,
    "lighting": 74,
    "emergency": 69,
    "noise": 82,
    "crowd": 73
  }
}
```

## Scoring Legend

- `80-100`: Excellent
- `60-79`: Good
- `40-59`: Fair
- `0-39`: Poor

## Data Used

- OpenStreetMap tags for road type, sidewalks, crossings, lighting, parks, shops, and emergency amenities
- Cached Visakhapatnam safety data in `visakhapatnam_safety_scores.json`
- Synthetic ML training data generated by `backend/train_model.py`

## Future Work

- Real-time crime and incident data integration
- AQI provider integration with local caching
- IoT-based street lighting and footpath condition signals
- Wearable tracking for walking safety alerts
- Offline-first tiles and routing for low-connectivity areas
- More advanced route ranking using user feedback

## Contribution

Contributions are welcome. Suggested areas:

- Improve OSM feature extraction
- Add more city-specific cached datasets
- Improve UI accessibility
- Add tests for routing and scoring logic
- Add screenshots and demo videos

## Contact

Project: SmartFoot  
Repository: https://github.com/deepika8mandakala/SmartFoot
