"""PyTorch twin of the numpy 1D-CNN branch (Kaggle GPU training).

Same architecture, same shapes, edge-equivalent padding (replicate mode
matches the numpy branch's edge padding exactly), so weights export 1:1 into
the numpy serving layout — the backend never needs torch.

torch is an optional import: only the Kaggle/training environment needs it.
"""
import numpy as np


def _torch():
    try:
        import torch
        import torch.nn as nn
    except ImportError as exc:
        raise RuntimeError(
            "torch is required for GPU CNN training (Kaggle has it preinstalled) — "
            "serving stays numpy-only"
        ) from exc
    return torch, nn


class TorchBloomCNN:
    """Conv(6→8) → Conv(8→16) → Conv(16→E), kernel 3, replicate padding."""

    def __init__(self, embedding_dim: int = 16):
        torch, nn = _torch()
        self.torch = torch
        self.net = nn.Sequential(
            nn.Conv1d(6, 8, 3, padding=0), nn.ReLU(),
            nn.Conv1d(8, 16, 3, padding=0), nn.ReLU(),
            nn.Conv1d(16, embedding_dim, 3, padding=0), nn.ReLU(),
        )
        self.head = nn.Linear(embedding_dim, 1)

    def _pad(self, x):
        F = self.torch.nn.functional
        return F.pad(x, (1, 1), mode="replicate")

    def forward(self, x):
        """x: (n, T, C) -> (logit, embedding)."""
        h = x.transpose(1, 2)  # (n, C, T)
        h = self.net[1](self.net[0](self._pad(h)))
        h = self.net[3](self.net[2](self._pad(h)))
        h = self.net[5](self.net[4](self._pad(h)))
        emb = h.mean(dim=2)
        return (self.head(emb).squeeze(-1), emb)

    def parameters(self):
        return list(self.net.parameters()) + list(self.head.parameters())


def train_torch_cnn(X_seq: np.ndarray, y: np.ndarray, epochs: int = 10,
                    lr: float = 1e-3, batch_size: int = 512,
                    seed: int = 7, device: str | None = None):
    """Train on GPU when available. Returns (model, history)."""
    torch, _ = _torch()
    g = torch.Generator().manual_seed(seed)
    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
    model = TorchBloomCNN()
    model.net.to(device)
    model.head.to(device)
    X = torch.as_tensor(np.asarray(X_seq, dtype=np.float32))
    w = torch.as_tensor(np.asarray(y, dtype=np.float32))
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    loss_fn = torch.nn.BCEWithLogitsLoss()
    n = len(X)
    hist = []
    for _ in range(epochs):
        perm = torch.randperm(n, generator=g)
        tot, cnt = 0.0, 0
        for i in range(0, n, batch_size):
            b = perm[i:i + batch_size]
            xb, wb = X[b].to(device), w[b].to(device)
            opt.zero_grad()
            logit, _ = model.forward(xb)
            loss = loss_fn(logit, wb)
            loss.backward()
            opt.step()
            tot += float(loss.detach()) * len(b)
            cnt += len(b)
        hist.append(tot / max(cnt, 1))
    return model, {"device": device, "loss": hist}


def export_to_numpy(model) -> dict:
    """Transpose torch (out, in, k) weights into the numpy (k, in, out) layout."""
    sd = model.net.state_dict()
    head = model.head.state_dict()
    return {
        "W1": sd["0.weight"].detach().cpu().numpy().transpose(2, 1, 0).astype(np.float32),
        "b1": sd["0.bias"].detach().cpu().numpy().astype(np.float32),
        "W2": sd["2.weight"].detach().cpu().numpy().transpose(2, 1, 0).astype(np.float32),
        "b2": sd["2.bias"].detach().cpu().numpy().astype(np.float32),
        "W3": sd["4.weight"].detach().cpu().numpy().transpose(2, 1, 0).astype(np.float32),
        "b3": sd["4.bias"].detach().cpu().numpy().astype(np.float32),
        "Wo": head["weight"].detach().cpu().numpy().T.astype(np.float32),
        "bo": head["bias"].detach().cpu().numpy().astype(np.float32),
    }
