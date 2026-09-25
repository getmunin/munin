# syntax=docker/dockerfile:1.7
#
# Munin PII annotation worker. Two targets from one file:
#
#   lite  spaCy nb_core_news_md only. No torch; the image stays small.
#   full  spaCy nb_core_news_lg + GLiNER2.5 (fastino/gliner2.5-multi-v1).
#
#   docker build --target lite -t pii-annotator:lite .
#   docker build --target full -t pii-annotator:full .
#
# Model weights are not baked in. Each install downloads them from upstream on
# first run into PII_CACHE_DIR (/models) — mount a volume there so later runs
# reuse them. That keeps the image from redistributing the weights.

FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PII_CACHE_DIR=/models \
    HF_HOME=/models/hf
WORKDIR /app
RUN useradd --create-home --uid 10001 annotator \
 && mkdir -p /models \
 && chown annotator:annotator /models
COPY pyproject.toml README.md ./
COPY src ./src

FROM base AS full
# The default torch wheel pulls NVIDIA CUDA packages and adds gigabytes to an
# image that never touches a GPU. Install the CPU-only build first so the
# gliner2[local] requirement is already satisfied.
RUN pip install --index-url https://download.pytorch.org/whl/cpu "torch>=2.1,<3" \
 && pip install ".[full]"
ENV PII_TIER=full
USER annotator
VOLUME ["/models"]
ENTRYPOINT ["python", "-m", "pii_annotator"]
CMD ["--once"]

FROM base AS lite
RUN pip install ".[lite]"
ENV PII_TIER=lite
USER annotator
VOLUME ["/models"]
ENTRYPOINT ["python", "-m", "pii_annotator"]
CMD ["--once"]
