"""1D-CNN branch for temporal satellite + weather patterns."""
import numpy as np


class BloomCNN:
    """Minimal 1D-CNN over 30 timesteps x 6 channels.

    Implemented with numpy convolutions to keep the dependency footprint
    zero-cost and CI-friendly. For production, swap in PyTorch via onnx export.
    """

    def __init__(self, n_timesteps: int = 30, n_channels: int = 6, embedding_dim: int = 16):
        self.n_timesteps = n_timesteps
        self.n_channels = n_channels
        self.embedding_dim = embedding_dim
        rng = np.random.default_rng(42)
        self.W1 = rng.standard_normal((3, n_channels, 8)) * 0.1
        self.W2 = rng.standard_normal((3, 8, 16)) * 0.1
        self.W3 = rng.standard_normal((3, 16, embedding_dim)) * 0.1
        self.b1 = np.zeros(8)
        self.b2 = np.zeros(16)
        self.b3 = np.zeros(embedding_dim)

    def _conv1d(self, x: np.ndarray, W: np.ndarray, b: np.ndarray) -> np.ndarray:
        """x: (batch, channels, time). W: (kernel, in_ch, out_ch)."""
        batch, in_ch, time = x.shape
        k, _, out_ch = W.shape
        pad = k // 2
        xp = np.pad(x, ((0, 0), (0, 0), (pad, pad)), mode="edge")
        out = np.zeros((batch, out_ch, time), dtype=np.float32)
        for oc in range(out_ch):
            for ic in range(in_ch):
                for t in range(time):
                    seg = xp[:, ic, t:t + k]
                    out[:, oc, t] += np.dot(seg, W[:, ic, oc])
            out[:, oc, :] += b[oc]
        return out

    def _relu(self, x: np.ndarray) -> np.ndarray:
        return np.maximum(0, x)

    def forward(self, x: np.ndarray) -> np.ndarray:
        """x: (batch, time, channels) -> embedding (batch, embedding_dim)."""
        xt = np.transpose(x, (0, 2, 1))
        h = self._relu(self._conv1d(xt, self.W1, self.b1))
        h = self._relu(self._conv1d(h, self.W2, self.b2))
        h = self._relu(self._conv1d(h, self.W3, self.b3))
        return h.mean(axis=2)

    def predict_embedding(self, x: np.ndarray) -> np.ndarray:
        return self.forward(np.asarray(x, dtype=np.float32))