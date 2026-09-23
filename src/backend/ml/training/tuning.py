"""Optuna hyperparameter search for the LightGBM branch (Kaggle-time only).

Optimizes time-series cross-validated Brier score — calibration-sensitive,
which is what public-health decisions need. Optuna is an optional import:
serving and CI never touch this module.
"""
import numpy as np


def _suggest(trial):
    return {
        "n_estimators": trial.suggest_int("n_estimators", 100, 500),
        "max_depth": trial.suggest_int("max_depth", 3, 10),
        "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.15, log=True),
        "num_leaves": trial.suggest_int("num_leaves", 15, 127),
        "subsample": trial.suggest_float("subsample", 0.6, 1.0),
        "colsample_bytree": trial.suggest_float("colsample_bytree", 0.6, 1.0),
        "min_child_samples": trial.suggest_int("min_child_samples", 10, 100),
        "reg_alpha": trial.suggest_float("reg_alpha", 1e-4, 1.0, log=True),
        "reg_lambda": trial.suggest_float("reg_lambda", 1e-4, 1.0, log=True),
        "random_state": 42,
        "verbose": -1,
    }


def tune_lightgbm(X: np.ndarray, y: np.ndarray, n_trials: int = 30,
                  n_splits: int = 3, seed: int = 42,
                  storage: str | None = None,
                  study_name: str = "bloomcast-lgbm") -> dict:
    """Return the best params by time-series CV Brier score.

    Pass storage (e.g. "sqlite:////kaggle/working/optuna.db") to persist
    trials: an interrupted run resumes instead of restarting.
    """
    try:
        import optuna
    except ImportError as exc:
        raise RuntimeError(
            "optuna is required for tuning (pip install optuna) — "
            "it is intentionally not a serving dependency"
        ) from exc
    import lightgbm as lgb
    from sklearn.metrics import brier_score_loss
    from sklearn.model_selection import TimeSeriesSplit

    X = np.asarray(X, dtype=np.float64)
    y = np.asarray(y, dtype=int)

    def objective(trial):
        params = _suggest(trial)
        tscv = TimeSeriesSplit(n_splits=n_splits)
        scores = []
        for tr, te in tscv.split(X):
            if len(np.unique(y[tr])) < 2 or len(np.unique(y[te])) < 2:
                continue
            m = lgb.LGBMClassifier(**params)
            m.fit(X[tr], y[tr])
            p = m.predict_proba(X[te])[:, 1]
            scores.append(brier_score_loss(y[te], p))
        if not scores:
            return float("inf")
        return float(np.mean(scores))

    sampler = optuna.samplers.TPESampler(seed=seed)
    study = optuna.create_study(direction="minimize", sampler=sampler,
                                storage=storage, study_name=study_name,
                                load_if_exists=True)
    study.optimize(objective, n_trials=n_trials)
    best = dict(study.best_params)
    best.update({"random_state": 42, "verbose": -1})
    return {"params": best, "best_brier": float(study.best_value),
            "n_trials": n_trials}


def train_quantiles(X: np.ndarray, y: np.ndarray, params: dict | None = None,
                    sample_weight=None):
    """Quantile LightGBM regressors (α=0.05/0.95) for prediction intervals.

    PRD §7.5: intervals widen with horizon and feature uncertainty. Trained on
    the binary labels as pseudo-continuous targets — a standard cheap
    approximation; the served CI is clipped to always bracket p_bloom.

    Uses the native booster API deliberately: the sklearn wrapper has no
    `alpha` parameter, so passing it through get_params() filtering silently
    trained two identical L2 regressors (found by byte-comparing outputs).
    Native params make objective/alpha explicit and testable.
    """
    import lightgbm as lgb

    X = np.asarray(X, dtype=np.float64)
    y = np.asarray(y, dtype=float)
    w = None if sample_weight is None else np.asarray(sample_weight, dtype=float)
    base = dict(params or {})
    n_rounds = int(base.pop("n_estimators", 200))
    native_params = {
        "objective": "quantile",
        "verbosity": -1,
        "seed": 42,
        "deterministic": True,
        "num_leaves": int(base.get("num_leaves", 31)),
        "max_depth": int(base.get("max_depth", -1)),
        "learning_rate": float(base.get("learning_rate", 0.05)),
        "feature_fraction": float(base.get("colsample_bytree", 0.8)),
        "bagging_fraction": float(base.get("subsample", 0.8)),
        "bagging_freq": 1,
        "min_data_in_leaf": int(base.get("min_child_samples", 20)),
        "lambda_l1": float(base.get("reg_alpha", 0.0)),
        "lambda_l2": float(base.get("reg_lambda", 0.0)),
    }
    models = {}
    for name, alpha in (("q05", 0.05), ("q95", 0.95)):
        train_set = lgb.Dataset(X, label=y, weight=w)
        models[name] = lgb.train(
            {**native_params, "alpha": alpha},
            train_set,
            num_boost_round=n_rounds,
        )
    return models
