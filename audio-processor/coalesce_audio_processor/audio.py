#!/usr/bin/env python3

import json
import functools
import tempfile
import pysbd
from faster_whisper import WhisperModel
from math import ceil
from pydub import AudioSegment


MODEL_NAME = "large-v2"

CHUNK_DURATION_MS = 60000


def split_audio(
    input_path: str,
    output_sink,
    chunk_ms=CHUNK_DURATION_MS,
    progress_callback=None,
    metadata_callback=None,
):
    audio = AudioSegment.from_file(input_path)

    chunk_len = audio.frame_count(chunk_ms)
    if chunk_len % 1 != 0:
        raise ValueError("chunk_ms must muliply into an integer number of samples")

    metadata = {
        "numberOfChannels": audio.channels,
        "sampleRate": audio.frame_rate,
        "sampleCount": int(audio.frame_count()),
        "chunkLength": int(chunk_len),
        "maxDBFS": audio.max_dBFS,
    }
    if metadata_callback:
        metadata_callback(metadata)

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


@functools.cache
def get_whisper_model(model_name=MODEL_NAME):
    return WhisperModel(model_name, device="auto", compute_type="float32")


def word_to_dict(word):
    word_data = word._asdict()
    word_data["text"] = word_data["word"]
    del word_data["word"]
    return word_data


# via https://github.com/guillaumekln/faster-whisper/issues/94#issuecomment-1489916191
def segment_to_dict(segment):
    segment = segment._asdict()
    segment["words"] = [word_to_dict(word) for word in segment["words"]]
    return segment


class SentenceSplitter:
    def __init__(self, language):
        self.text = None
        self.segmenter = pysbd.Segmenter(language=language)

    def update_sentence_ends(self, segment):
        for word in segment["words"]:
            if self.text is None:
                self.text = ""
                # Mark the first word transcribed as sentence start
                word["isSentenceStart"] = True

            self.text += word["text"]

            sentences = self.segmenter.segment(self.text)
            if len(sentences) > 1:
                word["isSentenceStart"] = True
                self.text = sentences[-1]


def transcribe_audio(
    input_path: str,
    output_sink,
    model_name=MODEL_NAME,
    progress_callback=None,
    segment_callback=None,
):
    whisper_model = get_whisper_model(model_name)

    # Encourage model to transcribe pauses and disfluencies
    # https://platform.openai.com/docs/guides/speech-to-text/prompting
    initial_prompt = "Umm, let me think um like, hmm... Okay, here's what um I'm, like, thinking. I uh... I... mmhmm. Yeah. Yup."

    segment_gen, info = whisper_model.transcribe(
        input_path,
        beam_size=5,
        initial_prompt=initial_prompt,
        word_timestamps=True,
        vad_filter=True,
    )

    splitter = SentenceSplitter(language=info.language)

    segments = []
    for segment in segment_gen:
        segment_dict = segment_to_dict(segment)
        splitter.update_sentence_ends(segment_dict)

        segments.append(segment_dict)
        if segment_callback:
            segment_callback(segment_dict)
        if progress_callback:
            progress_callback(segment.start, info.duration)

    result = {"segments": segments}
    output_sink("words.json", json.dumps(result))
