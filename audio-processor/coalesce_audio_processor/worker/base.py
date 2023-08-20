#!/usr/bin/env python3

import json
import mimetypes
import tempfile
import traceback
import asyncio
import aiohttp
import websockets
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


# TODO: reconnect websocket if disconnected
async def process_audio(job: ProcessAudioRequest):
    print("Processing job:", job.jobId)

    headers = {"Authorization": f"Bearer {job.jobKey}"}

    with tempfile.NamedTemporaryFile() as input_file:
        async with (
            aiohttp.ClientSession(raise_for_status=True) as session,
            session.get(job.inputURI, headers=headers) as resp,
            websockets.connect(job.statusURI, extra_headers=headers) as ws,
        ):
            loop = asyncio.get_event_loop()
            tasks = (transcribe_audio, split_audio)
            progress = defaultdict(int)

            async def send_update(update):
                await ws.send(json.dumps(update))

            async def send_progress(key, n, total):
                progress[key] = n / total
                await send_update(
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
                        url = job.outputURIBase + f"/{name}"
                        await group.create_task(
                            session.put(
                                url,
                                data=output_data,
                                headers={
                                    **headers,
                                    "Content-Type": mimetype
                                    or "application/octet-stream",
                                },
                            )
                        )

                    await send_update({"status": "running", "progress": 0})

                    async for chunk in resp.content.iter_chunked(1024):
                        input_file.write(chunk)

                    for task_func in tasks:

                        def progress_callback(key, n, total):
                            asyncio.run_coroutine_threadsafe(
                                send_progress(key, n, total), loop
                            )

                        def output_sink(name, output_data):
                            asyncio.run_coroutine_threadsafe(
                                upload_output(name, output_data), loop
                            )

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
                await send_update(
                    {
                        "status": "failed",
                        "error": "".join(traceback.format_exception(exc)),
                    }
                )
            else:
                await send_update({"status": "complete"})
            finally:
                await ws.close()


if __name__ == "__main__":
    main()
