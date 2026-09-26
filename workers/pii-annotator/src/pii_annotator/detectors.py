"""Person-name detectors.

Model libraries are imported lazily inside each detector, so the worker loop,
the HTTP client and the tests run without spaCy or torch installed.
"""

from __future__ import annotations

import logging
import shutil
import tempfile
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, Sequence

log = logging.getLogger(__name__)

MAX_SURFACE_LENGTH = 120

SPACY_MODEL_VERSION = "3.8.0"
SPACY_PERSON_LABELS = frozenset({"PER", "PERSON"})
# The NER component is all we use. Dropping the rest measured 75k -> 93k chars/s
# on nb_core_news_lg and cuts resident memory.
SPACY_EXCLUDE = ["morphologizer", "parser", "lemmatizer", "attribute_ruler"]
SPACY_WHEEL_URL = (
    "https://github.com/explosion/spacy-models/releases/download/"
    "{name}-{version}/{name}-{version}-py3-none-any.whl"
)


@dataclass(frozen=True)
class Span:
    start: int
    end: int
    text: str
    source: str


class Detector(Protocol):
    name: str

    def detect(self, texts: Sequence[str]) -> list[list[Span]]: ...


def keep_span(span: Span) -> bool:
    return bool(span.text.strip()) and len(span.text) <= MAX_SURFACE_LENGTH and span.end > span.start


def ensure_spacy_model(name: str, version: str, cache_dir: Path) -> Path:
    """Download a spaCy model wheel on first use and return its data directory.

    Weights are fetched from upstream by each install rather than baked into the
    image, so the image never redistributes them. The download lands in a temp
    directory and is renamed into place, so an interrupted first run never
    leaves a half-written model behind.
    """
    target = cache_dir / "spacy" / f"{name}-{version}"
    data_dir = target / name / f"{name}-{version}"
    if (data_dir / "meta.json").exists():
        return data_dir
    target.parent.mkdir(parents=True, exist_ok=True)
    url = SPACY_WHEEL_URL.format(name=name, version=version)
    log.info("downloading spaCy model %s-%s", name, version)
    with tempfile.TemporaryDirectory(dir=target.parent) as tmp:
        wheel = Path(tmp) / "model.whl"
        with urllib.request.urlopen(url, timeout=600) as response, wheel.open("wb") as out:
            shutil.copyfileobj(response, out)
        staging = Path(tmp) / "staging"
        with zipfile.ZipFile(wheel) as archive:
            members = [m for m in archive.namelist() if m.startswith(f"{name}/")]
            archive.extractall(staging, members)
        if target.exists():
            shutil.rmtree(target)
        staging.rename(target)
    if not (data_dir / "meta.json").exists():
        raise RuntimeError(f"spaCy model {name}-{version} did not unpack to {data_dir}")
    return data_dir


class SpacyDetector:
    def __init__(self, model_name: str, cache_dir: Path, batch_size: int = 64, nlp: Any = None):
        self.name = f"spacy:{model_name}-{SPACY_MODEL_VERSION}"
        self._batch_size = batch_size
        if nlp is None:
            import spacy

            nlp = spacy.load(ensure_spacy_model(model_name, SPACY_MODEL_VERSION, cache_dir), exclude=SPACY_EXCLUDE)
        self._nlp = nlp

    def detect(self, texts: Sequence[str]) -> list[list[Span]]:
        out: list[list[Span]] = []
        for doc in self._nlp.pipe(texts, batch_size=self._batch_size):
            spans = [
                Span(ent.start_char, ent.end_char, ent.text, "spacy")
                for ent in doc.ents
                if ent.label_ in SPACY_PERSON_LABELS
            ]
            out.append([s for s in spans if keep_span(s)])
        return out


class GlinerDetector:
    def __init__(self, model_id: str, threshold: float = 0.5, batch_size: int = 8, model: Any = None):
        self.name = f"gliner:{model_id}"
        self._threshold = threshold
        self._batch_size = batch_size
        if model is None:
            # GLiNER2.5 checkpoints only dispatch through AutoExtractor. The legacy
            # GLiNER2.from_pretrained span loader accepts them and then silently
            # extracts nothing. Needs `gliner2[local]` plus `peft`.
            from gliner2 import AutoExtractor

            model = AutoExtractor.from_pretrained(model_id)
        self._model = model

    def detect(self, texts: Sequence[str]) -> list[list[Span]]:
        out: list[list[Span]] = [[] for _ in texts]
        indexed = [(i, t) for i, t in enumerate(texts) if t.strip()]
        if not indexed:
            return out
        results = self._model.batch_extract_entities_long(
            [t for _, t in indexed],
            ["person"],
            batch_size=self._batch_size,
            threshold=self._threshold,
            include_spans=True,
        )
        for (i, _), result in zip(indexed, results):
            entities = ((result or {}).get("entities") or {}).get("person") or []
            spans = [
                Span(int(e["start"]), int(e["end"]), str(e["text"]), "gliner")
                for e in entities
                if isinstance(e, dict) and "start" in e and "end" in e and "text" in e
            ]
            out[i] = [s for s in spans if keep_span(s)]
        return out


class UnionDetector:
    def __init__(self, detectors: Sequence[Detector]):
        self.name = "+".join(d.name for d in detectors)
        self._detectors = list(detectors)

    def detect(self, texts: Sequence[str]) -> list[list[Span]]:
        merged: list[dict[tuple[int, int], Span]] = [{} for _ in texts]
        for detector in self._detectors:
            for i, spans in enumerate(detector.detect(texts)):
                for span in spans:
                    merged[i].setdefault((span.start, span.end), span)
        return [sorted(m.values(), key=lambda s: (s.start, s.end)) for m in merged]
