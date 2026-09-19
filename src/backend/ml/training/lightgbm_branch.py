"""LightGBM branch + calibration + baselines."""
import numpy as np
import lightgbm as lgb
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import roc_auc_score, brier_score_loss


class ClimatologyBaseline:
    """For each waterbody and day-of-year, historical bloom probability (5-year rolling mean)."""

    def __init__(self):
        self.table: dict = {}

    def fit(self, X: np.ndarray, y: np.ndarray, doy: np.ndarray, wb_ids: np.ndarray):
        for wb, d, label in zip(wb_ids, doy, y):
            self.table.setdefault((int(wb), int(d)), []).append(float(label))
        self.table = {k: float(np.mean(v)) for k, v in self.table.items()}
        return self

    def predict(self, X: np.ndarray, doy: np.ndarray, wb_ids: np.ndarray) -> np.ndarray:
        return np.array([self.table.get((int(wb), int(d)), 0.25) for wb, d in zip(wb_ids, doy)])


class PersistenceBaseline:
    """Current NDCI/chlorophyll-a persisted forward."""

    def __init__(self):
        self.median = 0.5

    def fit(self, X: np.ndarray, y: np.ndarray):
        self.median = float(np.median(X[:, 0])) if X.size else 0.5
        return self

    def predict(self, X: np.ndarray) -> np.ndarray:
        # Use the most recent spectral feature as the persistence signal
        idx = min(16, X.shape[1] - 1)
        raw = X[:, idx]
        return 1 / (1 + np.exp(-(raw - raw.mean()) * 2.0))


class WeatherOnlyBaseline:
    """Logistic regression on Open-Meteo features only."""

    def __init__(self):
        self.model = LogisticRegression(max_iter=1000)

    def fit(self, X: np.ndarray, y: np.ndarray):
        cols = list(range(0, 14))
        if X.shape[1] > 14:
            cols = list(range(14))
        self.model.fit(X[:, cols], y)
        return self

    def predict(self, X: np.ndarray) -> np.ndarray:
        cols = list(range(14))
        return self.model.predict_proba(X[:, cols])[:, 1]


class LightGBMBranch:
    def __init__(self):
        self.model = lgb.LGBMClassifier(
            n_estimators=200, max_depth=6, learning_rate=0.05,
            num_leaves=31, subsample=0.8, colsample_bytree=0.8,
            random_state=42, verbose=-1,
        )

    def fit(self, X: np.ndarray, y: np.ndarray):
        self.model.fit(X, y)
        return self

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        return self.model.predict_proba(X)[:, 1]

    def shap_values(self, X: np.ndarray):
        import shap
        explainer = shap.TreeExplainer(self.model)
        return explainer.shap_values(X)


def calibrate(oof_preds: np.ndarray, y_true: np.ndarray) -> IsotonicRegression:
    calibrator = IsotonicRegression(out_of_bounds="clip", y_min=0, y_max=1)
    calibrator.fit(oof_preds, y_true)
    return calibrator


def evaluate(y_true: np.ndarray, preds: np.ndarray) -> dict:
    return {
        "auc": float(roc_auc_score(y_true, preds)),
        "brier": float(brier_score_loss(y_true, preds)),
    }