import time
from tqdm import tqdm


class HookTqdm:
    """Monkeypatch global tqdm to call a specified function when it displays"""

    def __init__(self, callback=None):
        self.callback = callback

    def __enter__(self):
        self.original_method = tqdm.display

        def display(instance, msg=None, pos=None):
            # Undo swap inside display so callback can use tqdm
            tqdm.display = self.original_method
            self.callback(instance)
            tqdm.display = display
            return True

        tqdm.display = display
        return self

    def __exit__(self, type, value, traceback):
        tqdm.display = self.original_method


if __name__ == "__main__":

    def progress_callback(tqdm):
        print(tqdm.format_dict)

    with HookTqdm(callback=progress_callback):
        for i in tqdm(range(100)):
            time.sleep(0.1)
