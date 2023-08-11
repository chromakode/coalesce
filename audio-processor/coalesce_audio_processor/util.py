from contextlib import contextmanager

from nanoid import generate
from tqdm import tqdm


@contextmanager
def tqdm_from_callback(**kwargs):
    tqdm_instance = tqdm(**kwargs)

    def progress_callback(n, total):
        if tqdm_instance.total is None:
            tqdm_instance.reset(total)
        tqdm_instance.update(n - tqdm_instance.n)

    try:
        yield progress_callback
    finally:
        if tqdm_instance is not None:
            tqdm_instance.close()


def generate_id() -> str:
    return generate("6789BCDFGHJKLMNPQRTWbcdfghjkmnpqrtwz", 20)
