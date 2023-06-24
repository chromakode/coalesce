FROM python:3.10

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg

RUN python3 -m pip install poetry

WORKDIR /app

COPY poetry.lock pyproject.toml ./

RUN poetry install --no-root --with=gpu

# Cache models

RUN poetry run python -c 'import whisper; whisper.load_model("small")'
RUN poetry run python -c 'import torch; torch.hub.load(repo_or_dir="snakers4/silero-vad", model="silero_vad", onnx=True, source="github")'

COPY ./ ./

RUN poetry install --only-root

CMD ["poetry", "run", "coalesce_audio_processor", "worker", "transcribe", "chunks"]