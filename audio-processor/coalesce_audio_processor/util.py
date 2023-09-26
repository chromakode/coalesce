from contextlib import contextmanager

from nanoid import generate


def generate_id() -> str:
    return generate("6789BCDFGHJKLMNPQRTWbcdfghjkmnpqrtwz", 20)
