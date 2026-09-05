# Training environment

This experiment uses a local, ignored virtual environment at `.venv`, created
with exactly CPython 3.12.3. It is separate from the PWA dependencies and does
not add a Python or CUDA package to the shipped application.

The committed `requirements.in` identifies direct dependencies and
`requirements.lock` pins the complete resolved graph with hashes for Linux
ARM64. The PyTorch wheel is the official `2.10.0+cu128` CPython 3.12 ARM64
wheel. CUDA 12.8 user-space libraries are compatible with the host's newer
NVIDIA driver; every run nevertheless requires a successful CUDA probe and
fails explicitly when `--device cuda` cannot be satisfied.

Create the environment and install the reviewed lock:

```sh
python3.12 -m venv experiments/recognition-training/.venv
experiments/recognition-training/.venv/bin/python -m pip install --require-hashes -r experiments/recognition-training/requirements.lock
```

The trainer records its resolved Python, PyTorch, ONNX, ONNX Runtime, CUDA,
GPU/driver, command, commit, data hashes, checkpoint and model identities in
each report. It does not emit source paths, FENs, or label sequences.

`requirements.lock` is an exact Linux ARM64 wheel lock. The direct inputs were
resolved with `pip-tools 7.5.1`; that tool crashed while hashing the CUDA
multi-index graph, so the complete resolved graph was downloaded once into the
ignored `.bootstrap/wheels/` cache and each selected wheel was SHA-256 verified
before being recorded. Installation is still fail-closed with
`--require-hashes`; it cannot choose a newer package or an unrecorded wheel.
The lock keeps the public PyPI index plus PyTorch's immutable CUDA 12.8 wheel
index, pins `torch==2.10.0+cu128`, and forbids source distributions. To
recreate the ignored wheel cache before an offline installation, use
`./.venv/bin/python -m pip download --require-hashes --dest .bootstrap/wheels -r requirements.lock`.

`torch.cuda.is_available()` is not assumed from `nvidia-smi`. The CUDA-first
trainer checks it before loading data or constructing the model. CPU is allowed
only for export validation and deterministic unit tests when explicitly
requested.

After the lead has frozen source/data protocol and explicitly starts the run,
use these commands from this directory. The trainer refuses the held-out split;
the pilot takes the predeclared first 38 training and 16 development boards
from `data/full` and proves interrupted/resumed recovery before export.

```sh
./.venv/bin/python trainer.py --protocol protocol.json --data-dir data/full --run-dir runs/pilot --mode pilot --seed 38 --device cuda --verify-resume
./.venv/bin/python trainer.py --protocol protocol.json --data-dir data/full --run-dir runs/full-3801 --mode full --seed 3801 --device cuda
./.venv/bin/python trainer.py --protocol protocol.json --data-dir data/full --run-dir runs/full-3802 --mode full --seed 3802 --device cuda
```

The full commands require the successful matching pilot report. Only
`freeze.ts` may permit test loading; `evaluate_onnx.py --split test` requires
its immutable freeze record.
