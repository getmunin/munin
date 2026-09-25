from __future__ import annotations

import zipfile
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace

import pytest

from pii_annotator import detectors
from pii_annotator.client import BackendError, ClaimedMessage, SubmitResult
from pii_annotator.config import TIERS, Settings
from pii_annotator.detectors import GlinerDetector, Span, SpacyDetector, UnionDetector, ensure_spacy_model
from pii_annotator.worker import RunStats, run_loop, run_once


class FakeBackend:
    def __init__(self, batches: list[list[ClaimedMessage]]):
        self._batches = list(batches)
        self.claims: list[dict] = []
        self.submits: list[dict] = []

    def claim(self, **kwargs):
        self.claims.append(kwargs)
        return self._batches.pop(0) if self._batches else []

    def submit(self, **kwargs):
        self.submits.append(kwargs)
        return SubmitResult(
            accepted=len(kwargs["results"]),
            spans=sum(len(s) for _, s in kwargs["results"]),
            rejected=0,
        )


@dataclass
class KeywordDetector:
    name: str = "keyword"
    keyword: str = "Per Olsen"

    def detect(self, texts):
        out = []
        for text in texts:
            i = text.find(self.keyword)
            out.append([] if i < 0 else [Span(i, i + len(self.keyword), self.keyword, "test")])
        return out


def test_run_once_drains_the_backlog_and_submits_what_it_found():
    backend = FakeBackend(
        [
            [ClaimedMessage("cvm_1", "Hei, Per Olsen her"), ClaimedMessage("cvm_2", "Takk")],
            [ClaimedMessage("cvm_3", "Per Olsen igjen")],
        ]
    )
    stats = run_once(
        backend, KeywordDetector(), detector_version=100, batch_size=2, lease_seconds=60, holder="h"
    )
    assert stats.batches == 2
    assert stats.messages == 3
    assert stats.spans == 2
    assert len(backend.claims) == 3
    assert backend.claims[0] == {"detector_version": 100, "limit": 2, "lease_seconds": 60, "holder": "h"}
    first = backend.submits[0]
    assert first["detector"] == "keyword"
    assert first["results"][0] == ("cvm_1", [Span(5, 14, "Per Olsen", "test")])
    assert first["results"][1] == ("cvm_2", [])


def test_run_once_stops_at_max_batches():
    backend = FakeBackend([[ClaimedMessage("a", "x")], [ClaimedMessage("b", "y")]])
    stats = run_once(
        backend, KeywordDetector(), detector_version=1, batch_size=1, lease_seconds=60, holder="h", max_batches=1
    )
    assert stats.batches == 1
    assert len(backend.claims) == 1


def test_run_loop_survives_a_failed_sweep():
    calls = {"n": 0}
    slept: list[float] = []

    def sweep():
        calls["n"] += 1
        if calls["n"] == 1:
            raise BackendError(503, "pii_worker_disabled")
        return RunStats(messages=1)

    run_loop(sweep, interval_seconds=7, sleep=slept.append, should_continue=lambda: calls["n"] < 2)
    assert calls["n"] == 2
    assert slept == [7, 7]


def test_union_keeps_one_span_per_offset_pair():
    union = UnionDetector([KeywordDetector(name="a"), KeywordDetector(name="b", keyword="Olsen")])
    assert union.name == "a+b"
    assert union.detect(["Hei Per Olsen"]) == [
        [Span(4, 13, "Per Olsen", "test"), Span(8, 13, "Olsen", "test")]
    ]


def test_spacy_detector_keeps_person_entities_only():
    doc = SimpleNamespace(
        ents=[
            SimpleNamespace(start_char=4, end_char=13, text="Per Olsen", label_="PER"),
            SimpleNamespace(start_char=17, end_char=21, text="Oslo", label_="GPE_LOC"),
            SimpleNamespace(start_char=0, end_char=0, text="", label_="PER"),
        ]
    )
    nlp = SimpleNamespace(pipe=lambda texts, batch_size: [doc for _ in texts])
    detector = SpacyDetector("nb_core_news_md", Path("/unused"), nlp=nlp)
    assert detector.detect(["Hei Per Olsen fra Oslo"]) == [[Span(4, 13, "Per Olsen", "spacy")]]


def test_gliner_detector_reads_spans_and_skips_blank_texts():
    seen: list[list[str]] = []

    def extract(texts, labels, **kwargs):
        seen.append(texts)
        assert labels == ["person"]
        assert kwargs["include_spans"] is True
        return [{"entities": {"person": [{"text": "Lise", "start": 6, "end": 10}]}} for _ in texts]

    detector = GlinerDetector("fastino/test", model=SimpleNamespace(batch_extract_entities_long=extract))
    assert detector.detect(["", "Takk, Lise!"]) == [[], [Span(6, 10, "Lise", "gliner")]]
    assert seen == [["Takk, Lise!"]]


def test_ensure_spacy_model_unpacks_once_and_reuses_the_cache(tmp_path, monkeypatch):
    wheel = tmp_path / "nb_test-3.8.0.whl"
    with zipfile.ZipFile(wheel, "w") as archive:
        archive.writestr("nb_test/__init__.py", "")
        archive.writestr("nb_test/nb_test-3.8.0/meta.json", "{}")
        archive.writestr("nb_test-3.8.0.dist-info/METADATA", "")
    monkeypatch.setattr(detectors, "SPACY_WHEEL_URL", tmp_path.as_uri() + "/{name}-{version}.whl")
    cache = tmp_path / "cache"
    path = ensure_spacy_model("nb_test", "3.8.0", cache)
    assert path == cache / "spacy" / "nb_test-3.8.0" / "nb_test" / "nb_test-3.8.0"
    assert (path / "meta.json").exists()
    wheel.unlink()
    assert ensure_spacy_model("nb_test", "3.8.0", cache) == path


def test_settings_require_url_and_secret_and_default_the_version_per_tier():
    with pytest.raises(ValueError):
        Settings.from_env({"MUNIN_PII_WORKER_SECRET": "s"})
    with pytest.raises(ValueError):
        Settings.from_env({"MUNIN_API_URL": "http://backend:3001"})
    lite = Settings.from_env({"MUNIN_API_URL": "http://backend:3001", "MUNIN_PII_WORKER_SECRET": "a,b"})
    assert lite.secret == "a"
    assert lite.detector_version == TIERS["lite"].detector_version
    full = Settings.from_env(
        {"MUNIN_API_URL": "http://b", "MUNIN_PII_WORKER_SECRET": "s", "PII_TIER": "full", "PII_BATCH_SIZE": "8"}
    )
    assert full.detector_version > lite.detector_version
    assert full.batch_size == 8
    with pytest.raises(ValueError):
        Settings.from_env({"MUNIN_API_URL": "http://b", "MUNIN_PII_WORKER_SECRET": "s", "PII_TIER": "huge"})
