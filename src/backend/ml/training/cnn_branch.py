"""1D-CNN branch for temporal satellite + weather patterns."""
import numpy as np


class BloomCNN:
    """Minimal 1D-CNN over 30 timesteps x 6 channels.

    Implemented with numpy convolutions to keep the dependency footprint
    zero-cost and CI-friendly. For production, swap in PyTorch via onnx export.

    Channels: ndci, chlorophyll_a, temperature, wind_speed, precipitation, solar.
    """

    def __init__(self, n_timesteps: int = 30, n_channels: int = 6, embedding_dim: int = 16):
        self.n_timesteps = n_timesteps
        self.n_channels = n_channels
        self.embedding_dim = embedding_dim
        rng = np.random.default_rng(42)
        # He initialization: preserves activation variance through the ReLU
        # stack (a fixed 0.1 scale collapses activations to ~0 by layer 3 and
        # kills every gradient — verified by gradient check in tests).
        self.W1 = (rng.standard_normal((3, n_channels, 8)) * np.sqrt(2.0 / (3 * n_channels))).astype(np.float32)
        self.W2 = (rng.standard_normal((3, 8, 16)) * np.sqrt(2.0 / (3 * 8))).astype(np.float32)
        self.W3 = (rng.standard_normal((3, 16, embedding_dim)) * np.sqrt(2.0 / (3 * 16))).astype(np.float32)
        self.b1 = np.zeros(8, dtype=np.float32)
        self.b2 = np.zeros(16, dtype=np.float32)
        self.b3 = np.zeros(embedding_dim, dtype=np.float32)
        self.Wo = (rng.standard_normal((embedding_dim, 1)) * np.sqrt(1.0 / embedding_dim)).astype(np.float32)
        self.bo = np.zeros(1, dtype=np.float32)

    @staticmethod
    def _conv_fwd(x: np.ndarray, W: np.ndarray, b: np.ndarray) -> np.ndarray:
        """x: (n, Ci, T), W: (k, Ci, Co) -> (n, Co, T), same padding."""
        from numpy.lib.stride_tricks import sliding_window_view

        k = W.shape[0]
        pad = k // 2
        xp = np.pad(x, ((0, 0), (0, 0), (pad, pad)), mode="edge")
        win = sliding_window_view(xp, k, axis=2)  # (n, Ci, T, k)
        return np.einsum("nctk,kco->not", win, W).astype(np.float32) + b[None, :, None]

    @staticmethod
    def _relu(x: np.ndarray) -> np.ndarray:
        return np.maximum(x, 0, out=np.empty_like(x))

    def _forward_cache(self, x: np.ndarray):
        """x: (n, T, C) -> (embedding, cache)."""
        xt = np.transpose(x, (0, 2, 1)).astype(np.float32)
        z1 = self._conv_fwd(xt, self.W1, self.b1)
        h1 = self._relu(z1)
        z2 = self._conv_fwd(h1, self.W2, self.b2)
        h2 = self._relu(z2)
        z3 = self._conv_fwd(h2, self.W3, self.b3)
        h3 = self._relu(z3)
        emb = h3.mean(axis=2)
        cache = (xt, z1, h1, z2, h2, z3, h3)
        return emb, cache

    def forward(self, x: np.ndarray) -> np.ndarray:
        """x: (batch, time, channels) -> embedding (batch, embedding_dim)."""
        emb, _ = self._forward_cache(np.asarray(x, dtype=np.float32))
        return emb

    def predict_embedding(self, x: np.ndarray) -> np.ndarray:
        return self.forward(np.asarray(x, dtype=np.float32))

    def predict_proba(self, x: np.ndarray) -> np.ndarray:
        emb = self.forward(x)
        return 1.0 / (1.0 + np.exp(-(emb @ self.Wo + self.bo))).ravel()

    def fit(self, X_seq: np.ndarray, y: np.ndarray, epochs: int = 3,
            lr: float = 0.05, subsample: int = 1000, seed: int = 7):
        """Train the head + conv stack with full-batch SGD on BCE loss.

        Subsampled + few epochs by design: this is a small auxiliary branch,
        and the nightly CI job must stay within minutes.
        """
        rng = np.random.default_rng(seed)
        X = np.asarray(X_seq, dtype=np.float32)
        y = np.asarray(y, dtype=np.float32).ravel()
        n = min(subsample, len(X))
        idx = rng.choice(len(X), n, replace=False)
        X, y = X[idx], y[idx]
        T = X.shape[1]

        for _ in range(epochs):
            emb, (xt, z1, h1, z2, h2, z3, h3) = self._forward_cache(X)
            logit = emb @ self.Wo + self.bo
            p = 1.0 / (1.0 + np.exp(-logit))
            err = (p.ravel() - y) / n  # dBCE/dlogit, averaged

            dWo = emb.T @ err[:, None]
            dbo = err.sum(keepdims=True)
            demb = err[:, None] @ self.Wo.T  # (n, E)
            dh3 = np.repeat((demb / T)[:, :, None], T, axis=2) * (z3 > 0)
            dW3, db3, dh2 = self._conv_bwd(dh3, h2, self.W3)
            dh2 = dh2 * (z2 > 0)
            dW2, db2, dh1 = self._conv_bwd(dh2, h1, self.W2)
            dh1 = dh1 * (z1 > 0)
            dW1, db1, _ = self._conv_bwd(dh1, xt, self.W1)

            self.Wo -= lr * dWo
            self.bo -= lr * dbo.ravel()
            self.W3 -= lr * dW3
            self.b3 -= lr * db3
            self.W2 -= lr * dW2
            self.b2 -= lr * db2
            self.W1 -= lr * dW1
            self.b1 -= lr * db1
        return self

    @staticmethod
    def _conv_bwd(dout: np.ndarray, x_in: np.ndarray, W: np.ndarray):
        """dout: (n, Co, T), x_in: (n, Ci, T), W: (k, Ci, Co).

        Returns (dW, db, dx_in).
        """
        from numpy.lib.stride_tricks import sliding_window_view

        n, _, T = dout.shape
        k = W.shape[0]
        pad = k // 2
        xp = np.pad(x_in, ((0, 0), (0, 0), (pad, pad)), mode="edge")
        win = sliding_window_view(xp, k, axis=2)  # (n, Ci, T, k)
        dW = np.einsum("nctk,not->kco", win, dout)
        db = dout.sum(axis=(0, 2))
        # dx pre-padding: out[t] = sum_kk xp[t+kk] W[kk]
        dxp = np.zeros_like(xp)
        for kk in range(k):
            dxp[:, :, kk:kk + T] += np.einsum("not,co->nct", dout, W[kk])
        dx = dxp[:, :, pad:pad + T] if pad else dxp
        return dW.astype(np.float32), db.astype(np.float32), dx.astype(np.float32)
