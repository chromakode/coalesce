# Coalesce

Coalesce is an audio editor which makes slicing dialogue as easy as editing text.

![Screenshot](./screenshot.png)

---

## Project Status

🚧 Barebones Demo 🚧

Features:

- AI transcription using [whisper-timestamped](https://github.com/linto-ai/whisper-timestamped)
- Nondestructive text editing: remove and reorder spoken words as text
- Visually refine word timings with a waveform editor
- Export mixed down mono 48khz audio

Next up:

- [x] Lazy load audio data from chunks
- [x] Improve playback perf w/ incremental lookahead audio scheduler
- [x] Highlight words as they're played
- [x] Drag and drop files to transcribe and process
- [x] Collaborative editing
- [ ] Export separate audio tracks
- [ ] Add sound clips

## How to use

The easiest way to get started is to build and launch the containers:

1. `DOCKER_BUILDKIT=1 docker-compose up --env-file docker-compose.env --profile process-audio`
2. Browse to https://localhost:3000

## Development

To run all services in watch mode:

1. `DOCKER_BUILDKIT=1 docker-compose --env-file docker-compose.env -f docker-compose.yml -f docker-compose.dev.yml up`
2. Browse to https://localhost:4000

Tailing logs:

`docker-compose -f docker-compose.yml -f docker-compose.dev.yml logs --follow`

Running with a GPU:

`DOCKER_BUILDKIT=1 docker-compose --env-file docker-compose.env -f docker-compose.yml -f docker-compose.gpu.yml up --profile process-audio`