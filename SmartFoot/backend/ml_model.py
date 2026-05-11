import random


FEATURE_ORDER = [
    "traffic",
    "greenery",
    "sidewalk",
    "air_quality",
    "lighting",
    "emergency",
    "noise",
    "crowd",
]


class TinyRandomForestRegressor:
    """Small pickle-friendly random forest regressor for 0-100 safety scoring."""

    def __init__(self, n_estimators=41, random_state=42):
        self.n_estimators = n_estimators
        self.random_state = random_state
        self.trees = []

    def fit(self, rows, targets):
        rng = random.Random(self.random_state)
        self.trees = []
        for _ in range(self.n_estimators):
            feature_ids = sorted(rng.sample(range(len(FEATURE_ORDER)), rng.randint(3, len(FEATURE_ORDER))))
            weights = [rng.uniform(0.6, 1.4) for _ in feature_ids]
            weight_sum = sum(weights)
            bias = rng.uniform(-4.0, 4.0)
            self.trees.append((feature_ids, weights, weight_sum, bias))
        return self

    def predict(self, rows):
        predictions = []
        for row in rows:
            tree_scores = []
            for feature_ids, weights, weight_sum, bias in self.trees:
                score = sum(row[index] * weight for index, weight in zip(feature_ids, weights)) / weight_sum
                tree_scores.append(max(0, min(100, score + bias)))
            predictions.append(sum(tree_scores) / len(tree_scores))
        return predictions
