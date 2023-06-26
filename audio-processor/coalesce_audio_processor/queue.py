import json
import redis
from typing import Dict, Any


# TODO: interrupt jobs when canceled
class QueueConsumer:
    def __init__(self, redis_url: str, queue_name: str, processing_queue_name: str):
        self.redis_url = redis_url
        self.queue_name = queue_name
        self.processing_queue_name = processing_queue_name

        self.redis_client = redis.from_url(self.redis_url)

    async def process_item(self, item: Dict[str, Any], publish_status: Dict[str, Any]):
        pass

    async def consume(self):
        print(f'Processing jobs from queue "{self.queue_name}"...', flush=True)

        while True:
            raw_item = self.redis_client.blmove(
                self.queue_name, self.processing_queue_name, 0, "LEFT", "RIGHT"
            )

            item_data = json.loads(raw_item)

            print(f"Consumed item: {item_data}", flush=True)

            job_id = item_data["id"]
            project_id = item_data["project"]
            pubsub_channel = f"project:{project_id}.job"
            status_key = f"project:{project_id}.job.{job_id}"

            def update_status(status):
                self.redis_client.set(
                    status_key, json.dumps({**item_data, "state": status})
                )
                self.redis_client.publish(
                    pubsub_channel,
                    json.dumps({"type": "job-status", **item_data, "state": status}),
                )
                self.redis_client.expire(status_key, 60 * 60)

            def publish_progress(status):
                update_status({"status": "running", **status})

            try:
                await self.process_item(item_data, publish_progress)

                # If processing is successful, remove the message from the processing queue
                self.redis_client.lrem(self.processing_queue_name, 0, raw_item)

                update_status({"status": "complete"})

            except* Exception as eg:
                for e in eg.exceptions:
                    print(f"An error occurred: {e}", flush=True)

                # If an error occurred during processing, the message will remain in the processing queue
                update_status({"status": "failed", "error": str(e)})

    def empty(self):
        self.redis_client.delete(self.queue_name)
