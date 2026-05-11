import json
import os
import sqlite3
from pathlib import Path

from flask import Flask, abort, jsonify, render_template, request, send_from_directory

from backend.db import init_db
from backend.scoring import predict_score
from flask_cors import CORS
CORS(app)

BASE_DIR = Path(__file__).resolve().parent

app = Flask(__name__, static_folder="static", template_folder="templates")
init_db()


def send_page(filename):
    return send_from_directory(BASE_DIR, filename)


@app.route("/")
def index():
    return send_page("home.html")


@app.route("/<path:filename>")
def root_file(filename):
    allowed_pages = {
        "index.html",
        "home.html",
        "about.html",
        "safe-route.html",
        "walkability.html",
        "feedback.html",
        "report-issues.html",
        "smart-foot.png",
    }
    if filename in allowed_pages:
        return send_from_directory(BASE_DIR, filename)
    abort(404)


@app.route("/safe-route")
def safe_route():
    return send_page("safe-route.html")


@app.route("/walkability")
def walkability_page():
    return send_page("walkability.html")


@app.route("/api/scores")
def get_scores():
    with open(BASE_DIR / "static" / "scores.json", "r", encoding="utf-8") as file:
        return jsonify(json.load(file))


@app.route("/update_location", methods=["POST"])
def update_location():
    data = request.get_json(silent=True) or {}
    lat = data.get("lat")
    lng = data.get("lng")

    if lat is None or lng is None:
        return jsonify({"error": "lat and lng are required"}), 400

    return jsonify({
        "sidewalk": 70,
        "greenery": 60,
        "air": 80,
        "safety": 65,
    })


@app.route("/submit-feedback", methods=["POST"])
def submit_feedback():
    name = request.form.get("name", "").strip()
    message = request.form.get("message", "").strip()

    with open(BASE_DIR / "feedback_data.json", "a", encoding="utf-8") as file:
        file.write(json.dumps({"name": name, "message": message}) + "\n")

    return "<script>alert('Thank you for your feedback!'); window.location.href='/feedback.html';</script>"


@app.route("/api/walkability-data")
def walkability_data():
    lat = request.args.get("lat", type=float)
    lng = request.args.get("lng", type=float)
    if lat is None or lng is None:
        return jsonify({"error": "lat and lng are required"}), 400
    return jsonify(predict_score(lat, lng))


@app.route("/predict-score", methods=["GET", "POST"])
def predict_score_endpoint():
    data = request.get_json(silent=True) or {}
    lat = request.args.get("lat", type=float) if request.method == "GET" else data.get("lat")
    lng = request.args.get("lng", type=float) if request.method == "GET" else data.get("lng")
    if lat is None or lng is None:
        return jsonify({"error": "lat and lng are required"}), 400
    return jsonify(predict_score(float(lat), float(lng)))


@app.route("/admin")
def admin():
    conn = sqlite3.connect(BASE_DIR / "walkability.db")
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM feedback ORDER BY timestamp DESC")
    data = cursor.fetchall()
    conn.close()
    return render_template("admin.html", feedback=data)


@app.route("/leaderboard")
def leaderboard():
    conn = sqlite3.connect(BASE_DIR / "walkability.db")
    cursor = conn.cursor()
    cursor.execute("SELECT location, AVG(total_score) FROM feedback GROUP BY location ORDER BY AVG(total_score) DESC")
    rows = cursor.fetchall()
    conn.close()
    return jsonify([{"location": row[0], "average_score": row[1]} for row in rows])


@app.route("/api/get-safety-scores", methods=["POST"])
def get_safety_scores():
    try:
        data = request.get_json(silent=True) or {}
        from_loc = data.get("from", "").strip().lower()
        to_loc = data.get("to", "").strip().lower()

        if not from_loc or not to_loc:
            return jsonify([])

        with open(BASE_DIR / "visakhapatnam_safety_scores.json", "r", encoding="utf-8") as file:
            scores = json.load(file)

        matches = [
            {
                "from_location": from_loc.title(),
                "to_location": to_loc.title(),
                "summary": item["location"],
                "safetyScore": round(item.get("safety_score", 0) * 10),
                "waypoints": ", ".join(item.get("safety_landmarks", [])),
            }
            for item in scores
            if from_loc in item.get("location", "").lower() or to_loc in item.get("location", "").lower()
        ]
        return jsonify(matches[:5])
    except Exception as exc:
        app.logger.exception("Safety score lookup failed: %s", exc)
        return jsonify({"error": "Server error"}), 500

if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)
