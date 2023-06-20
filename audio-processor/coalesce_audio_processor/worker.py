#!/usr/bin/env python3

import os
import argparse
from typing import Dict
from pydantic import BaseModel
from .queue import QueueConsumer
from .audio import transcribe_audio, split_audio


REDIS_URL = os.getenv("REDIS_URL")
QUEUE_NAME = os.getenv("QUEUE_NAME")
PROCESSING_QUEUE_NAME = os.getenv("PROCESSING_QUEUE_NAME")


class ProcessJob(BaseModel):
    id: str
    project: str
    track: str
    task: str
    inputFile: str
    outputDir: str


class InvalidJobError(Exception):
    pass


class CoalesceConsumer(QueueConsumer):
    def __init__(self, redis_url, queue_name, processing_queue_name, roles):
        super().__init__(redis_url, queue_name, processing_queue_name)
        self.roles = roles

    def process_item(self, item_data, publish_progress):
        job = ProcessJob(**item_data)

        if job.task not in self.roles:
            raise InvalidJobError()

        def progress_callback(n, total):
            publish_progress({"progress": n / total}),

        publish_progress({"progress": 0})

        if job.task == "transcribe":
            transcribe_audio(
                job.inputFile,
                job.outputDir,
                progress_callback=progress_callback,
            )
        elif job.task == "chunks":
            split_audio(
                job.inputFile,
                job.outputDir,
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

    consumer = CoalesceConsumer(
        redis_url=REDIS_URL,
        queue_name=QUEUE_NAME,
        processing_queue_name=PROCESSING_QUEUE_NAME,
        roles=args.roles,
    )

    if args.command == "worker":
        consumer.consume()
    elif args.command == "empty":
        consumer.empty()


if __name__ == "__main__":
    main()
