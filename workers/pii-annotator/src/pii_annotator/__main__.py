"""Command-line entry point: `python -m pii_annotator --once | --loop`."""

from __future__ import annotations

import argparse
import logging
import os
import socket
import sys
import uuid

from .client import BackendError, HttpAnnotationBackend
from .config import Settings, build_detector
from .worker import run_loop, run_once

log = logging.getLogger("pii_annotator")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pii-annotator", description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true", help="drain the backlog and exit (default)")
    mode.add_argument("--loop", action="store_true", help="sweep every PII_LOOP_INTERVAL_SECONDS, forever")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=os.environ.get("PII_LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    try:
        settings = Settings.from_env()
    except ValueError as err:
        log.error("%s", err)
        return 2

    holder = f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"
    log.info(
        "tier %s, detector v%d, holder %s",
        settings.tier.name,
        settings.detector_version,
        holder,
    )
    detector = build_detector(settings)
    backend = HttpAnnotationBackend(settings.api_url, settings.secret)

    def sweep():
        return run_once(
            backend,
            detector,
            detector_version=settings.detector_version,
            batch_size=settings.batch_size,
            lease_seconds=settings.lease_seconds,
            holder=holder,
            max_batches=settings.max_batches,
        )

    if args.loop:
        run_loop(sweep, interval_seconds=settings.loop_interval_seconds)
        return 0

    try:
        stats = sweep()
    except BackendError as err:
        log.error("%s", err)
        return 3 if err.status == 503 else 1
    log.info("done: %d message(s), %d span(s), %d rejected", stats.messages, stats.spans, stats.rejected)
    return 0


if __name__ == "__main__":
    sys.exit(main())
