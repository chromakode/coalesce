FROM nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04

RUN --mount=type=cache,target=/var/cache/apt \
    apt-get update && \
    apt-get install -y --no-install-recommends \
        python3.11 python3-pip ffmpeg

RUN python3.11 -m pip install poetry

WORKDIR /app

COPY poetry.lock pyproject.toml ./

RUN --mount=type=cache,target=/root/.cache/pypoetry/cache \
    --mount=type=cache,target=/root/.cache/pypoetry/artifacts \
    poetry install --no-root

# Cache models

RUN poetry run python -c 'import faster_whisper; faster_whisper.download_model("large-v2")'

COPY ./ ./

RUN --mount=type=cache,target=/root/.cache/pypoetry/cache \
    --mount=type=cache,target=/root/.cache/pypoetry/artifacts \
    poetry install --only-root

CMD ["poetry", "run", "coalesce_http_worker"]