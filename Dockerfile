FROM python:3.11-slim

ARG DEBIAN_FRONTEND=noninteractive
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    NODE_VERSION=20

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       curl \
       ca-certificates \
       gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY src/frontend/package.json src/frontend/package.json
COPY src/backend/pyproject.toml src/backend/
COPY src/backend/requirements.txt src/backend/

RUN npm install --prefix src/frontend --legacy-peer-deps

COPY src/frontend/ src/frontend/
COPY src/backend/ src/backend/
COPY src/data/ src/data/
COPY fhir/ fhir/
COPY docs/ docs/
COPY scripts/ scripts/
COPY tests/ tests/
COPY pyproject.toml .
COPY turbo.json .

RUN cd src/frontend && npm run build \
    && cd src/backend && pip install -r requirements.txt

ENV SEED_DIR=../data/seed \
    WATERBODY_FILE=../data/waterbodies.geojson \
    STREAM_FILE=../data/stream_segments.geojson \
    REPLAY_FILE=../data/replay_events.json \
    CORS_ORIGINS=* \
    PYTHONPATH=/app/src/backend

EXPOSE 10000

CMD ["sh", "-c", "cd src/backend && uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-10000}"]