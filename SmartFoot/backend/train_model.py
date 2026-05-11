import pickle
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.ml_model import FEATURE_ORDER, TinyRandomForestRegressor


MODEL_PATH = Path(__file__).resolve().parent / "model.pkl"


def synthetic_target(row):
    values = dict(zip(FEATURE_ORDER, row))
    score = (
        values["traffic"] * 0.18
        + values["greenery"] * 0.13
        + values["sidewalk"] * 0.17
        + values["air_quality"] * 0.12
        + values["lighting"] * 0.12
        + values["emergency"] * 0.11
        + values["noise"] * 0.07
        + values["crowd"] * 0.10
    )
    if values["sidewalk"] > 75 and values["lighting"] > 70:
        score += 3
    if values["traffic"] < 45 and values["crowd"] > 75:
        score -= 4
    return max(0, min(100, score))


def build_dataset(size=520, seed=42):
    rng = random.Random(seed)
    rows = []
    targets = []
    for _ in range(size):
        row = [rng.randint(25, 98) for _ in FEATURE_ORDER]
        target = synthetic_target(row) + rng.uniform(-5, 5)
        rows.append(row)
        targets.append(max(0, min(100, target)))
    return rows, targets


def train():
    rows, targets = build_dataset()
    model = TinyRandomForestRegressor(n_estimators=51, random_state=7).fit(rows, targets)
    with open(MODEL_PATH, "wb") as file:
        pickle.dump(model, file)
    print(f"Saved model to {MODEL_PATH}")


if __name__ == "__main__":
    train()
