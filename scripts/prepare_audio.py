#!/usr/bin/env python3

import sys
import os
import json
from os import path
from pydub import AudioSegment

CHUNK_DURATION_MS = 60000


def split_audio(filename, format, chunk_ms=CHUNK_DURATION_MS):
    audio = AudioSegment.from_file(filename)

    chunk_len = audio.frame_count(chunk_ms)
    if chunk_len % 1 != 0:
        raise ValueError(
            "chunk_ms must muliply into an integer number of samples"
        )

    name, ext = path.splitext(filename)
    duration_ms = len(audio)
    start = 0
    end = 0
    counter = 0
    audio_chunks = []

    while start < duration_ms:
        end = min(start + chunk_ms, duration_ms)
        chunk = audio[start:end]
        chunk_name = f"chunks/{name}-{counter}.flac"
        chunk.export(chunk_name, format="flac")
        print(chunk_name)

        audio_chunks.append(chunk_name)
        counter += 1
        start += chunk_ms

    info = {
        'numberOfChannels': audio.channels,
        'sampleRate': audio.frame_rate,
        'sampleCount': int(audio.frame_count()),
        'chunkLength': int(chunk_len),
        'chunks': audio_chunks,
    }
    return name, info


if __name__ == '__main__':
    os.makedirs("chunks", exist_ok=True)

    index = {}

    filenames = sys.argv[1:]
    for filename in filenames:
        name, info = split_audio(filename, format="flac")
        index[name] = info

    index_file_path = "chunks/index.json"
    with open(index_file_path, "w") as index_file:
        json.dump(index, index_file)
        print(index_file_path)
