#!/usr/bin/env python3

import os
import io
import argparse
import tempfile
import asyncio
import aiohttp
import torch
from typing import Dict
from pydantic import BaseModel
from .queue import QueueConsumer
from .audio import transcribe_audio, split_audio


REDIS_URL = os.getenv("REDIS_URL")
AUDIO_QUEUE_NAME = os.getenv("AUDIO_QUEUE_NAME")
AUDIO_PROCESSING_QUEUE_NAME = os.getenv("AUDIO_PROCESSING_QUEUE_NAME")


class ProcessJob(BaseModel):
    id: str
    project: str
    track: str
    task: str
    inputURI: str
    outputURI: str
    outputFormData: Dict[str, str]


class InvalidJobError(Exception):
    pass


class CoalesceConsumer(QueueConsumer):
    def __init__(self, redis_url, queue_name, processing_queue_name, roles):
        super().__init__(redis_url, queue_name, processing_queue_name)
        self.roles = roles

    async def process_item(self, item_data, publish_progress):
        job = ProcessJob(**item_data)

        if job.task not in self.roles:
            raise InvalidJobError()

        def progress_callback(n, total):
            publish_progress({"progress": n / total}),

        publish_progress({"progress": 0})

        with tempfile.NamedTemporaryFile() as input_file:
            async with (
                aiohttp.ClientSession(raise_for_status=True) as session,
                session.get(job.inputURI) as resp,
                asyncio.TaskGroup() as group,
            ):
                async for chunk in resp.content.iter_chunked(1024):
                    input_file.write(chunk)

                def output_sink(name, output_data, close=False):
                    form_data = aiohttp.FormData(job.outputFormData)
                    form_data.add_field("file", output_data, filename=name)
                    group.create_task(session.post(job.outputURI, data=form_data))

                if job.task == "transcribe":
                    transcribe_audio(
                        input_file.name,
                        output_sink=output_sink,
                        progress_callback=progress_callback,
                    )
                elif job.task == "chunks":
                    split_audio(
                        input_file.name,
                        output_sink=output_sink,
                        progress_callback=progress_callback,
                    )
                else:
                    raise InvalidJobError()


def main():
    parser = argparse.ArgumentParser(
        description="Coalesce processor queue worker",
    )
    parser.set_defaults(roles=[])

    subparsers = parser.add_subparsers(required=True, dest="command")
    subparsers.add_parser("empty", help="Empty queue")

    worker_parser = subparsers.add_parser("worker", help="Clear queue")
    worker_parser.add_argument(
        "roles",
        type=str,
        nargs="+",
        choices=("transcribe", "chunks"),
        help="type of jobs to process",
    )

    args = parser.parse_args()

    print("GPU available:", torch.cuda.is_available())

    consumer = CoalesceConsumer(
        redis_url=REDIS_URL,
        queue_name=AUDIO_QUEUE_NAME,
        processing_queue_name=AUDIO_PROCESSING_QUEUE_NAME,
        roles=args.roles,
    )

    if args.command == "worker":
        asyncio.run(consumer.consume())
    elif args.command == "empty":
        consumer.empty()


if __name__ == "__main__":
    main()
