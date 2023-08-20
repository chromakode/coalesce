FROM python:3.11

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg

RUN python3 -m pip install poetry

WORKDIR /app

COPY poetry.lock pyproject.toml ./

RUN --mount=type=cache,target=/root/.cache/pypoetry/cache \
    --mount=type=cache,target=/root/.cache/pypoetry/artifacts \
    poetry install --no-root --with=gpu

# Cache models

RUN poetry run python -c 'import whisper; whisper.load_model("small")'
RUN poetry run python -c 'import torch; torch.hub.load(repo_or_dir="snakers4/silero-vad", model="silero_vad", onnx=True, source="github")'

COPY ./ ./

RUN --mount=type=cache,target=/root/.cache/pypoetry/cache \
    --mount=type=cache,target=/root/.cache/pypoetry/artifacts \
    poetry install --only-root

CMD ["poetry", "run", "coalesce_http_worker"]