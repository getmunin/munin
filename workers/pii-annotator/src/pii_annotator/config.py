"""Environment-driven settings and tier definitions."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

from .detectors import Detector, GlinerDetector, SpacyDetector, UnionDetector


@dataclass(frozen=True)
class Tier:
    name: str
    detector_version: int
    spacy_model: str
    gliner_model: str | None


# Detector versions are monotonic across tiers. The backend re-annotates any
# message stamped with a lower version, so moving lite -> full re-runs history
# and moving full -> lite keeps the better annotations. Bump a tier's version
# whenever its models change; leave room below the next tier's range.
TIERS: Mapping[str, Tier] = {
    "lite": Tier("lite", 100, "nb_core_news_md", None),
    "full": Tier("full", 200, "nb_core_news_lg", "fastino/gliner2.5-multi-v1"),
}


@dataclass(frozen=True)
class Settings:
    api_url: str
    secret: str
    tier: Tier
    detector_version: int
    batch_size: int
    lease_seconds: int
    loop_interval_seconds: int
    max_batches: int
    cache_dir: Path
    gliner_threshold: float

    @staticmethod
    def from_env(env: Mapping[str, str] | None = None) -> "Settings":
        env = os.environ if env is None else env
        api_url = env.get("MUNIN_API_URL", "").strip()
        secret = env.get("MUNIN_PII_WORKER_SECRET", "").split(",")[0].strip()
        if not api_url:
            raise ValueError("MUNIN_API_URL is required, e.g. http://backend:3001")
        if not secret:
            raise ValueError("MUNIN_PII_WORKER_SECRET is required")
        tier_name = env.get("PII_TIER", "lite").strip().lower()
        if tier_name not in TIERS:
            raise ValueError(f"PII_TIER must be one of {', '.join(TIERS)}, got {tier_name!r}")
        tier = TIERS[tier_name]
        return Settings(
            api_url=api_url,
            secret=secret,
            tier=tier,
            detector_version=_int(env, "PII_DETECTOR_VERSION", tier.detector_version, 1),
            batch_size=_int(env, "PII_BATCH_SIZE", 32, 1, 200),
            lease_seconds=_int(env, "PII_LEASE_SECONDS", 900, 30, 3600),
            loop_interval_seconds=_int(env, "PII_LOOP_INTERVAL_SECONDS", 300, 5),
            max_batches=_int(env, "PII_MAX_BATCHES", 0, 0),
            cache_dir=Path(env.get("PII_CACHE_DIR", "/models")),
            gliner_threshold=float(env.get("PII_GLINER_THRESHOLD", "0.5")),
        )


def build_detector(settings: Settings) -> Detector:
    spacy = SpacyDetector(settings.tier.spacy_model, settings.cache_dir)
    if settings.tier.gliner_model is None:
        return spacy
    gliner = GlinerDetector(settings.tier.gliner_model, threshold=settings.gliner_threshold)
    return UnionDetector([spacy, gliner])


def _int(env: Mapping[str, str], name: str, default: int, minimum: int, maximum: int | None = None) -> int:
    raw = env.get(name)
    if raw is None or raw.strip() == "":
        return default
    value = int(raw)
    if value < minimum or (maximum is not None and value > maximum):
        bounds = f">= {minimum}" if maximum is None else f"between {minimum} and {maximum}"
        raise ValueError(f"{name} must be {bounds}, got {value}")
    return value
