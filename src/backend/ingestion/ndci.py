"""Spectral index computation for Sentinel-2 bands."""
import numpy as np


def ndci(b05: np.ndarray, b04: np.ndarray) -> np.ndarray:
    """Normalized Difference Chlorophyll Index (red-edge based).

    NDCI = (B05 - B04) / (B05 + B04)

    Sentinel-2's red-edge band B05 (705 nm) is the killer feature:
    chlorophyll-a in turbid productive water produces its strongest signal here.
    """
    denom = b05 + b04
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(denom != 0, (b05 - b04) / denom, np.nan)


def chlorophyll_a(b03: np.ndarray, b04: np.ndarray, b05: np.ndarray, b06: np.ndarray) -> np.ndarray:
    """Approximate chlorophyll-a concentration (ug/L) from red-edge bands."""
    with np.errstate(divide="ignore", invalid="ignore"):
        ratio = np.where((b04 + b05) != 0, (b05 - b04) / (b05 + b04), np.nan)
    return np.where(np.isnan(ratio), np.nan, 10.0 * np.exp(2.5 * np.nan_to_num(ratio, nan=0.0)))


def ndvi(b08: np.ndarray, b04: np.ndarray) -> np.ndarray:
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where((b08 + b04) != 0, (b08 - b04) / (b08 + b04), np.nan)


def fai(b08: np.ndarray, b04: np.ndarray, b11: np.ndarray) -> np.ndarray:
    """Floating Algae Index."""
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where((b11 - b04) != 0, b08 - b04 - (b11 - b04) * ((833 - 665) / (1610 - 665)), np.nan)


def false_color_chip(ndci_values: np.ndarray, size: int = 256) -> np.ndarray:
    """Render a false-color NDCI chip (RGB uint8 array).

    Ramp: deep teal (low NDCI) -> bright magenta (high NDCI).
    """
    flat = np.clip(ndci_values, -0.2, 0.3)
    t = (flat + 0.2) / 0.5
    t = np.clip(t, 0.0, 1.0)
    r = np.where(t < 0.5, 2 + 253 * (t / 0.5), 255)
    g = np.where(t < 0.5, 17 + 238 * (t / 0.5), 255 - 205 * ((t - 0.5) / 0.5))
    b = np.where(t < 0.5, 43 + 159 * (t / 0.5), 50)
    rgb = np.stack([r, g, b], axis=-1).astype(np.uint8)
    n = int(np.sqrt(len(rgb)))
    if n * n < len(rgb):
        n += 1
    canvas = np.zeros((n * size // n, n * size // n, 3), dtype=np.uint8) if False else np.zeros((size, size, 3), dtype=np.uint8)
    canvas[:, :, :] = rgb[:size * size].reshape(size, size, 3) if len(rgb) >= size * size else canvas
    return canvas