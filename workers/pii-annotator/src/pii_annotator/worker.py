"""The claim / detect / submit loop."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Callable

from .client import AnnotationBackend, BackendError
from .detectors import Detector

log = logging.getLogger(__name__)


@dataclass
class RunStats:
    batches: int = 0
    messages: int = 0
    spans: int = 0
    rejected: int = 0
    errors: list[str] = field(default_factory=list)


def run_once(
    backend: AnnotationBackend,
    detector: Detector,
    *,
    detector_version: int,
    batch_size: int,
    lease_seconds: int,
    holder: str,
    max_batches: int = 0,
) -> RunStats:
    """Drain the backlog: claim, detect and submit until nothing is left."""
    stats = RunStats()
    while max_batches == 0 or stats.batches < max_batches:
        items = backend.claim(
            detector_version=detector_version,
            limit=batch_size,
            lease_seconds=lease_seconds,
            holder=holder,
        )
        if not items:
            break
        detected = detector.detect([item.text for item in items])
        result = backend.submit(
            holder=holder,
            detector_version=detector_version,
            detector=detector.name,
            results=[(item.message_id, spans) for item, spans in zip(items, detected)],
        )
        stats.batches += 1
        stats.messages += result.accepted
        stats.spans += result.spans
        stats.rejected += result.rejected
        log.info(
            "batch %d: %d message(s), %d span(s), %d rejected",
            stats.batches,
            result.accepted,
            result.spans,
            result.rejected,
        )
    return stats


def run_loop(
    run: Callable[[], RunStats],
    *,
    interval_seconds: int,
    sleep: Callable[[float], None] = time.sleep,
    should_continue: Callable[[], bool] = lambda: True,
) -> None:
    """Sweep, then wait, forever. A failed sweep is logged and retried next time."""
    while should_continue():
        try:
            stats = run()
            if stats.messages:
                log.info("sweep annotated %d message(s)", stats.messages)
        except BackendError as err:
            if err.status == 503:
                log.warning("backend is not accepting annotation workers: %s", err.body[:200])
            else:
                log.error("sweep failed: %s", err)
        except OSError as err:
            log.error("sweep failed, backend unreachable: %s", err)
        sleep(interval_seconds)
