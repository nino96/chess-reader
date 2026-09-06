# ChessVision.dev: bounded public-document review

Reviewed 2026-09-06. This is ChessVision.dev, not an assertion about any other
similarly named service. Dynamic pages returned empty body text through direct
web extraction; primary-domain search extracts supplied the readable content.
No API request, image submission, subscription or fine-tuning was performed.

The [product page](https://chessvision.dev/) describes a convolutional network
that locates the grid and classifies its squares, then assembles FEN. It
advertises a pretrained Base tier from $9/month and isolated Dedicated Pro
fine-tuning from $79/month, with versioning and rollback. Pro users are said to
be able to export 1.03 MB fine-tuned weights for execution on end-user devices.
This makes local deployment worth investigating if an export becomes available;
hosted API use is not the only advertised option.

Its perfect-accuracy claim concerns the customer's exact board design. There
is no published source-held-out printed-book benchmark, denominator, confidence
policy or error analysis accompanying that claim. Training inventory,
architecture details, optimizer, annotation format, export format, runtime,
and model-distribution license were not established by the pages reviewed.
These are unknowns, not evidence that its model fails.

The [API docs](https://chessvision.dev/docs) describe authenticated image uploads
and FEN/rotation/flip responses, and recommend a backend proxy to protect keys.
That hosted workflow does not meet this product's offline contract. The product
page mentions confidence/bounds, but the example API response does not establish
their exact schema. Returned side-to-move or castling values must never become
image-derived truth: a diagram alone cannot establish them.

The [terms](https://chessvision.dev/terms) retain submitter ownership but allow
processing and Base crowdsourcing to improve the shared model. They acknowledge
Pro weight export before account closure. Data retention/deletion details and
rights to redistribute an export with a PWA remain unverified. No upload or
commercial agreement is authorized in this project.

## Dataset consequence

Keep independently verified local labels and reserve whole unseen designs.
Custom-design adaptation and generalization to unseen printed books are separate
questions. If a future approved export is obtained, freeze its actual weights,
preprocessing/runtime, terms and source inventory before a bounded same-input
comparison with FENShot. Predictions are proposals, never label truth. Do not
add another model lane or increase the training budget in [#41](https://github.com/nino96/chess-reader/issues/41).
