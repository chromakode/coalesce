#!/usr/bin/env python3

import sys
import os
import argparse
import json
import whisper_timestamped as whisper
import numpy as np
from math import ceil
from typing import List
from os import path
from pydub import AudioSegment


from .tqdm_hook import HookTqdm
from .util import tqdm_from_callback

CHUNK_DURATION_MS = 60000


def make_chunks(
    input_path: str, output_dir: str, chunk_ms=CHUNK_DURATION_MS, progress_callback=None
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
        chunk_path = path.join(output_dir, chunk_name)
        chunk.export(chunk_path, format="flac")

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
    return index_data


def split_audio(input_path: str, output_dir: str, progress_callback=None):
    index_data = make_chunks(
        input_path, output_dir, progress_callback=progress_callback
    )

    index_file_path = path.join(output_dir, "chunks.json")
    with open(index_file_path, "w") as index_file:
        json.dump(index_data, index_file)


def transcribe_audio(
    input_path: str, output_dir: str, model="tiny", progress_callback=None
):
    audio = whisper.load_audio(input_path)

    model = whisper.load_model(model)

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

    output_path = path.join(output_dir, "words.json")
    with open(output_path, "w") as output_file:
        json.dump(result, output_file)


def process_audio(input_paths: List[str], project_dir: str, verbose=False):
    for input_path in input_paths:
        filename = path.basename(input_path)
        name, ext = path.splitext(filename)

        track_dir = path.join(project_dir, "track", name)
        os.makedirs(track_dir, exist_ok=True)

        with tqdm_from_callback(
            desc=f"transcribe {filename}", unit="words", leave=True, disable=not verbose
        ) as cb:
            transcribe_audio(input_path, name, track_dir, progress_callback=cb)

        with tqdm_from_callback(
            desc=f"split {filename} into chunks",
            unit="chunks",
            leave=True,
            disable=not verbose,
        ) as cb:
            split_audio(input_path, name, track_dir, progress_callback=cb)


def cli():
    parser = argparse.ArgumentParser(
        description="Transcribe and pre-process audio for Coalesce",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("audio", nargs="+", type=str, help="audio file(s) to process")
    parser.add_argument(
        "--output_dir",
        "-o",
        type=str,
        default=".",
        help="directory to save output",
    )
    parser.add_argument(
        "--quiet",
        "-q",
        action="store_true",
        help="Disable progress output",
    )

    args = parser.parse_args()
    process_audio(args.audio, args.output_dir, verbose=not args.quiet)


if __name__ == "__main__":
    cli()
