#!/usr/bin/env python3

import json
import mimetypes
import tempfile
import traceback
import asyncio
import aiohttp
import websockets
from aiohttp_retry import RetryClient, ExponentialRetry
from collections import defaultdict
from functools import partial
from pydantic import BaseModel
from ..audio import get_whisper_model, transcribe_audio, split_audio


class ProcessAudioRequest(BaseModel):
    jobId: str
    jobKey: str
    statusURI: str
    inputURI: str
    outputURIBase: str


def prepare():
    get_whisper_model()


class StatusSocket:
    def __init__(self, uri, headers):
        self.uri = uri
        self.headers = headers
        self.latest_status = None
        self.status_updated = asyncio.Event()
        self.ws = None
        self.loop_task = None

    async def _connect(self):
        self.ws = await websockets.connect(self.uri, extra_headers=self.headers)

    async def send_update(self, value):
        self.latest_status = value
        self.status_updated.set()

    async def __aenter__(self):
        await self._connect()
        self.loop_task = asyncio.create_task(self.loop())
        return self

    async def __aexit__(self, exc_type, exc, tb):
        if self.ws:
            await self.ws.close()
            self.ws = None
        self.loop_task.cancel()

    async def loop(self):
        while True:
            try:
                await self.ws.send(json.dumps(self.latest_status))
                self.status_updated.clear()
                await self.status_updated.wait()
            except websockets.ConnectionClosed:
                while not self.ws.open:
                    print("Reconnecting to WebSocket...", flush=True)
                    await asyncio.sleep(1)
                    try:
                        await self._connect()
                    except Exception as exc:
                        print("WebSocket error:", exc)
                    else:
                        print("WebSocket connected", flush=True)
                continue


async def process_audio(job: ProcessAudioRequest):
    print("Processing job:", job.jobId)

    headers = {"Authorization": f"Bearer {job.jobKey}"}
    retry_options = ExponentialRetry(attempts=3, exceptions=(Exception,))

    with tempfile.NamedTemporaryFile() as input_file:
        async with (
            RetryClient(raise_for_status=True, retry_options=retry_options) as session,
            session.get(job.inputURI, headers=headers) as resp,
            StatusSocket(job.statusURI, headers=headers) as status,
        ):
            loop = asyncio.get_event_loop()
            progress = defaultdict(int)

            async def send_progress(key, n, total):
                progress[key] = n / total
                await status.send_update(
                    {
                        "status": "running",
                        "progress": (
                            0.1 * progress["split_audio"]
                            + 0.9 * progress["transcribe_audio"]
                        ),
                    }
                )

            try:
                async with asyncio.TaskGroup() as group:

                    async def upload_output(name, output_data):
                        mimetype, _ = mimetypes.guess_type(name)
                        await session.put(
                            f"{job.outputURIBase}/{name}",
                            data=output_data,
                            headers={
                                **headers,
                                "Content-Type": mimetype or "application/octet-stream",
                            },
                        )

                    await status.send_update({"status": "running", "progress": 0})

                    async for chunk in resp.content.iter_chunked(1024):
                        input_file.write(chunk)

                    for task_func in (transcribe_audio, split_audio):

                        def progress_callback(key, n, total):
                            asyncio.run_coroutine_threadsafe(
                                send_progress(key, n, total), loop
                            )

                        def output_sink(name, output_data):
                            asyncio.run_coroutine_threadsafe(
                                upload_output(name, output_data), loop
                            ).result()

                        task_name = task_func.__name__
                        group.create_task(
                            asyncio.to_thread(
                                task_func,
                                input_file.name,
                                output_sink=output_sink,
                                progress_callback=partial(progress_callback, task_name),
                            )
                        )

            except* Exception as exc:
                traceback.print_exception(exc)
                await status.send_update(
                    {
                        "status": "failed",
                        "error": "".join(traceback.format_exception(exc)),
                    }
                )
            else:
                await status.send_update({"status": "complete"})


if __name__ == "__main__":
    main()
