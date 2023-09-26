#!/usr/bin/env python3

import os
import argparse
import hmac
from aiohttp import web
from .base import ProcessAudioRequest, prepare, process_audio


WORKER_PORT = os.getenv("WORKER_PORT")
WORKER_KEY = os.getenv("WORKER_KEY")


async def handle_request(request):
    if not hmac.compare_digest(
        request.headers.get("Authorization"), f"Bearer {WORKER_KEY}"
    ):
        raise web.HTTPForbidden
    job_data = await request.json()
    job = ProcessAudioRequest(**job_data)

    await process_audio(job)

    return web.Response(status=200)


def main():
    prepare()

    app = web.Application()
    app.add_routes([web.post("/process-audio/{job_id}", handle_request)])
    web.run_app(app, port=WORKER_PORT)


if __name__ == "__main__":
    main()
