# Bounded FENShot adaptation and native pretrained comparison

Tracks [issue #40](https://github.com/nino96/chess-reader/issues/40), the separate
executable follow-up under [#24](https://github.com/nino96/chess-reader/issues/24).
The [preparation](../planning/COMPARISON.md) records the design and reconstruction
feasibility. Original and v2 experiments are frozen historical controls.

The comparison includes unchanged FENShot, two learned-weight adaptation seeds,
and at most two public pretrained alternatives: Fenify and NAKSTStudio. No new
scratch training is included. All tools, dependencies, data and weights are
isolated from production. PR #39 remains unmerged; #24 stays open. Physical iPad
is deferred/unrun.

## Execution contract

[protocol.json](protocol.json) fixes the model/optimizer, seeds, sizes, confidence
floor, compute ceilings and promotion rules. The adaptation graph retains all
ten learned Conv/FC tensors from shipped FENShot and has no BatchNorm. It starts
a new optimizer and does not resume the original training trajectory. Both
seeds run the same recipe; failed runs and candidates remain evidence.

The mechanics pilot is limited to 60 GPU wall seconds and 256 training boards.
Each full seed is limited to 600 GPU wall seconds and twelve epochs; total
training ceiling is 1,260 seconds including the pilot and failed attempts.
This is a ceiling, not an estimated duration. Every epoch records class/family
loss and diagnostic accuracy/confidence; selected checkpoints receive strict
PyTorch/ONNX parity and a cheap development diagnostic before further evaluation.

Raw square accuracy does not pass the classifier gate. Qualification requires
at least 95% reliable exact boards, 99.5% confident correct squares and zero
reliable wrong boards at the retained confidence floor. Occupied-square,
per-class/color/family/degradation, pristine preservation, confidence/coverage
and orientation evidence are reported separately. The adaptation recommendation
also requires the predeclared improvement/preservation rules in both seeds.

A pretraining lock must bind the protocol, source/data manifests, implementation,
renderer checks and reviewed visual artifacts. Training reads only train and
development splits. Qualification is opened once only after all nominated models
and confidence policies are frozen. Corpus v1 is post-freeze regression only;
exposed Firi/Rhos outcomes remain historical diagnostic evidence.

Native alternative input/schema/decoding checks precede accuracy comparison.
Only predicted board geometry may feed detector decoding. Crop classifiers are
not credited with full-page localization or inferred orientation. Public model
research use and production distribution are separate reviews; downloaded
weights and dependencies remain in ignored local caches.

Follow the [staged evaluation policy](../../../docs/evaluation.md#staged-isolated-model-experiments).
Offline failures stop before full browser benchmarking. A changed exported graph
needs the small compatibility smoke at its applicable stage; complete product
and physical-device gates apply at integration. Existing product evidence is
reused by relevant hashes, not reported as a new pass.

## Current status

The bounded comparison is complete: both fine-tuning seeds and both pretrained
alternatives stop offline. See the [result and verification report](REPORT.md),
[aggregate comparison](reports/comparison.json), and
[learning curves](reports/learning-curves.csv). The selected fine-tuned models
slightly improve raw exact-board counts while increasing confidently wrong boards.
No candidate qualifies for fresh-test or browser evaluation. Production, frozen
experiments and corpus v1 remain unchanged; #24 stays open and iPad is deferred/unrun.
