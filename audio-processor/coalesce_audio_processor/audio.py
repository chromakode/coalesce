#!/usr/bin/env python3

import sys
import os
import argparse
import json
import functools
import tempfile
import whisper_timestamped as whisper
import numpy as np
from math import ceil
from typing import List
from os import path
from pydub import AudioSegment


from .tqdm_hook import HookTqdm
from .util import tqdm_from_callback

CHUNK_DURATION_MS = 60000


def split_audio(
    input_path: str, output_sink, chunk_ms=CHUNK_DURATION_MS, progress_callback=None
):
    audio = AudioSegment.from_file(input_path)

    chunk_len = audio.frame_count(chunk_ms)
    if chunk_len % 1 != 0:
        raise ValueError("chunk_ms must muliply into an integer number of samples")

    duration_ms = len(audio)
    start = 0
    end = 0
    counter = 0
    total = ceil(duration_ms / CHUNK_DURATION_MS)
    audio_chunks = []

    while start < duration_ms:
        end = min(start + chunk_ms, duration_ms)
        chunk = audio[start:end]
        chunk_name = f"{counter}.flac"

        with tempfile.NamedTemporaryFile() as out:
            chunk.export(out, format="flac")
            output_sink(chunk_name, out.read())

        audio_chunks.append(chunk_name)
        counter += 1
        start += chunk_ms

        if progress_callback:
            progress_callback(counter, total)

    index_data = {
        "numberOfChannels": audio.channels,
        "sampleRate": audio.frame_rate,
        "sampleCount": int(audio.frame_count()),
        "chunkLength": int(chunk_len),
        "chunks": audio_chunks,
    }
    output_sink("chunks.json", json.dumps(index_data))


@functools.cache
def get_whisper_model(model_name):
    return whisper.load_model(model_name)


def transcribe_audio(
    input_path: str, output_sink, model_name="small", progress_callback=None
):
    audio = whisper.load_audio(input_path)

    model = get_whisper_model(model_name)

    accurate_opts = dict(
        best_of=5,
        beam_size=5,
        # https://github.com/linto-ai/whisper-timestamped/blob/2c55305d6aa53f0c0fa1fe63fc85c33bfa60e963/whisper_timestamped/transcribe.py#LL2258C23-L2258C99
        temperature=tuple(np.arange(0, 1.0 + 1e-6, 0.2)),
    )

    def tqdm_update(tqdm):
        if progress_callback:
            state = tqdm.format_dict
            progress_callback(state["n"], state["total"])

    with HookTqdm(tqdm_update):
        result = whisper.transcribe(model, audio, vad=True, **accurate_opts)

    output_sink("words.json", json.dumps(result))
