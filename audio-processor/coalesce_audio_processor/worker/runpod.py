#!/usr/bin/env python3

import asyncio
import runpod
from .base import ProcessAudioRequest, prepare, process_audio


async def handler(event):
    job = ProcessAudioRequest(**event["input"])
    await process_audio(job)
    return True


prepare()
runpod.serverless.start({"handler": handler})
