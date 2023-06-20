FROM python:3.10

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg

RUN python3 -m pip install poetry

WORKDIR /app

COPY poetry.lock pyproject.toml ./

RUN poetry install --no-root

COPY ./ ./

RUN poetry install --only-root

#TODO: cache model data

CMD ["poetry", "run", "coalesce_audio_processor", "worker", "transcribe", "chunks"]