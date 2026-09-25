"""HTTP client for the backend's annotation endpoints."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Protocol, Sequence

from .detectors import Span


@dataclass(frozen=True)
class ClaimedMessage:
    message_id: str
    text: str


@dataclass(frozen=True)
class SubmitResult:
    accepted: int
    spans: int
    rejected: int


class BackendError(RuntimeError):
    def __init__(self, status: int, body: str):
        super().__init__(f"backend answered {status}: {body[:500]}")
        self.status = status
        self.body = body


class AnnotationBackend(Protocol):
    def claim(self, *, detector_version: int, limit: int, lease_seconds: int, holder: str) -> list[ClaimedMessage]: ...

    def submit(
        self,
        *,
        holder: str,
        detector_version: int,
        detector: str,
        results: Sequence[tuple[str, Sequence[Span]]],
    ) -> SubmitResult: ...


class HttpAnnotationBackend:
    def __init__(self, base_url: str, secret: str, timeout: float = 120.0):
        self._base = base_url.rstrip("/")
        self._secret = secret
        self._timeout = timeout

    def claim(self, *, detector_version: int, limit: int, lease_seconds: int, holder: str) -> list[ClaimedMessage]:
        payload = self._post(
            "claim",
            {
                "detectorVersion": detector_version,
                "limit": limit,
                "leaseSeconds": lease_seconds,
                "holder": holder,
            },
        )
        return [ClaimedMessage(message_id=i["messageId"], text=i["text"]) for i in payload.get("items", [])]

    def submit(
        self,
        *,
        holder: str,
        detector_version: int,
        detector: str,
        results: Sequence[tuple[str, Sequence[Span]]],
    ) -> SubmitResult:
        payload = self._post(
            "submit",
            {
                "holder": holder,
                "detectorVersion": detector_version,
                "detector": detector,
                "results": [
                    {
                        "messageId": message_id,
                        "spans": [
                            {
                                "start": s.start,
                                "end": s.end,
                                "text": s.text,
                                "label": "person",
                                "source": s.source,
                            }
                            for s in spans
                        ],
                    }
                    for message_id, spans in results
                ],
            },
        )
        return SubmitResult(
            accepted=int(payload.get("accepted", 0)),
            spans=int(payload.get("spans", 0)),
            rejected=len(payload.get("rejected", [])),
        )

    def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        request = urllib.request.Request(
            f"{self._base}/v1/pii/annotations/{path}",
            data=json.dumps(body).encode("utf-8"),
            method="POST",
            headers={
                "content-type": "application/json",
                "authorization": f"Bearer {self._secret}",
                "user-agent": "munin-pii-annotator",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                return json.loads(response.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as err:
            raise BackendError(err.code, err.read().decode("utf-8", "replace")) from err
