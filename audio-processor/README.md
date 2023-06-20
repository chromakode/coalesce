# Coalesce Audio Processor

This package contains the audio processing and transcription code for Coalesce.

To install: `poetry install`

The processing can either be run as a redis queue worker (taking jobs from the Coalesce Project Server) via `coalesce_audio_processor`, or manually via the `coalesce_process_audio` script.