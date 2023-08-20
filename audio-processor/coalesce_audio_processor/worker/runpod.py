#!/usr/bin/env python3

import runpod
from .base import ProcessAudioRequest, prepare, process_audio


def handler(event):
    job = ProcessAudioRequest(**event["input"])
    process_audio(job)


prepare()
runpod.serverless.start({"handler": handler})
