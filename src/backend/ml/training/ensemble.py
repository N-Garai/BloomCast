"""Ensemble meta-learner combining LightGBM + CNN embedding + tabular features."""
import numpy as np
from sklearn.linear_model import LogisticRegression


class Ensemble:
    """Logistic meta-learner over LightGBM probability + CNN embedding.

    The tabular block is deliberately excluded from the meta-learner input:
    it is already fully consumed by the LightGBM branch, and re-entering raw
    features at the meta level lets the stack re-fit on them and collapse the
    counterfactual response (the perturbation is invisible to the meta model
    because it sees the perturbed row directly).
    """

    def __init__(self):
        self.meta = LogisticRegression(max_iter=1000)

    def fit(self, lgbm_proba: np.ndarray, cnn_emb: np.ndarray, tabular: np.ndarray, y: np.ndarray):
        lp = np.asarray(lgbm_proba).reshape(-1, 1)
        ce = np.asarray(cnn_emb).reshape(len(y), -1)
        X = np.hstack([lp, ce])
        self.meta.fit(X, y)
        return self

    def predict_proba(self, lgbm_proba: float, cnn_emb: np.ndarray, tabular: np.ndarray) -> float:
        lp = np.asarray([[float(lgbm_proba)]])
        ce = np.asarray(cnn_emb).reshape(1, -1)
        X = np.hstack([lp, ce])
        return float(self.meta.predict_proba(X)[0, 1])