#!/usr/bin/env python3

import json
import mimetypes
import tempfile
import traceback
import asyncio
from typing import Literal
import websockets
from aiohttp_retry import RetryClient, ExponentialRetry
from collections import defaultdict
from functools import partial
from pydantic import BaseModel
from ..audio import get_whisper_model, transcribe_audio, split_audio

MsgKind = Literal["status", "chunks", "segment"]


class ProcessAudioRequest(BaseModel):
    jobId: str
    jobKey: str
    statusURI: str
    inputURI: str
    outputURIBase: str


def prepare():
    print(f"Loading model...", flush=True)
    whisper_model = get_whisper_model()
    model = whisper_model.model
    print(
        f"Model loaded. compute_type={model.compute_type} device={model.device}",
        flush=True,
    )


class WorkerSocket:
    def __init__(self, uri, headers):
        self.uri = uri
        self.headers = headers
        self.msg_queue = []
        self.has_msgs_queued = asyncio.Event()
        self.ws = None
        self.loop_task = None

    async def _connect(self):
        self.ws = await websockets.connect(self.uri, extra_headers=self.headers)

    async def queue_send(self, kind: MsgKind, value):
        self.msg_queue.append({"kind": kind, "data": value})
        self.has_msgs_queued.set()

    async def __aenter__(self):
        await self._connect()
        self.loop_task = asyncio.create_task(self.loop())
        return self

    async def __aexit__(self, exc_type, exc, tb):
        if self.loop_task:
            self.loop_task.cancel()
        if self.ws:
            # Flush any final queued status update
            if self.has_msgs_queued.is_set():
                await self.send_queued()
            await self.ws.close()
            self.ws = None

    async def send_queued(self):
        if not self.ws:
            return

        tries = 0
        while True:
            try:
                while len(self.msg_queue) > 0:
                    await self.ws.send(json.dumps(self.msg_queue[0]))
                    self.msg_queue.pop(0)
                self.has_msgs_queued.clear()
                break
            except websockets.ConnectionClosed:
                tries += 1
                if tries > 5:
                    raise

                while not self.ws.open:
                    print("Reconnecting to WebSocket...", flush=True)
                    await asyncio.sleep(0.5 * tries)
                    try:
                        await self._connect()
                    except Exception as exc:
                        print("WebSocket error:", exc)
                    else:
                        print("WebSocket connected", flush=True)

    async def loop(self):
        while True:
            await self.send_queued()
            await self.has_msgs_queued.wait()


async def process_audio(job: ProcessAudioRequest):
    print("Processing job:", job.jobId, flush=True)

    headers = {"Authorization": f"Bearer {job.jobKey}"}
    retry_options = ExponentialRetry(attempts=3, exceptions=(Exception,))

    with tempfile.NamedTemporaryFile() as input_file:
        async with (
            RetryClient(raise_for_status=True, retry_options=retry_options) as session,
            session.get(job.inputURI, headers=headers) as resp,
            WorkerSocket(job.statusURI, headers=headers) as socket,
        ):
            loop = asyncio.get_event_loop()
            progress = defaultdict(int)

            async def send_progress(key, n, total):
                progress[key] = n / total
                await socket.queue_send(
                    "status",
                    {
                        "status": "running",
                        "progress": (
                            0.1 * progress["split_audio"]
                            + 0.9 * progress["transcribe_audio"]
                        ),
                    },
                )

            async def send_data(kind, data):
                await socket.queue_send(kind, data)

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

                    await socket.queue_send(
                        "status", {"status": "running", "progress": 0}
                    )

                    async for chunk in resp.content.iter_chunked(1024):
                        input_file.write(chunk)

                    def progress_callback(key, n, total):
                        asyncio.run_coroutine_threadsafe(
                            send_progress(key, n, total), loop
                        )

                    def segment_callback(segment):
                        asyncio.run_coroutine_threadsafe(
                            send_data("segment", segment), loop
                        ).result()

                    def metadata_callback(metadata):
                        asyncio.run_coroutine_threadsafe(
                            send_data("metadata", metadata), loop
                        ).result()

                    def output_sink(name, output_data):
                        asyncio.run_coroutine_threadsafe(
                            upload_output(name, output_data), loop
                        ).result()

                    group.create_task(
                        asyncio.to_thread(
                            split_audio,
                            input_file.name,
                            output_sink=output_sink,
                            progress_callback=partial(progress_callback, "split_audio"),
                            metadata_callback=metadata_callback,
                        )
                    )

                    group.create_task(
                        asyncio.to_thread(
                            transcribe_audio,
                            input_file.name,
                            output_sink=output_sink,
                            progress_callback=partial(
                                progress_callback, "transcribe_audio"
                            ),
                            segment_callback=segment_callback,
                        )
                    )

            except* Exception as exc:
                traceback.print_exception(exc)
                await socket.queue_send(
                    "status",
                    {
                        "status": "failed",
                        "error": "".join(traceback.format_exception(exc)),
                    },
                )
            else:
                await socket.queue_send("status", {"status": "complete"})
                print("Finished job:", job.jobId, flush=True)


if __name__ == "__main__":
    main()
