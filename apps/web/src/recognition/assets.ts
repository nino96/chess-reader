/**
 * Pinned, self-hosted model/runtime assets for offline recognition
 * (docs/architecture.md §8, docs/decisions/0005-browser-recognition.md,
 * docs/dependency-policy.md §4). Nothing here is fetched from a CDN; both
 * files ship inside this app's own build output and are content-addressed
 * (see `assets.test.ts`) so a corrupted or substituted asset is rejected
 * before it can run (`recognition.worker.ts` re-verifies `MODEL_SHA256` at
 * runtime against the fetched bytes and fails closed on mismatch).
 *
 * Provenance:
 * - `@scoriiu/fenshot@0.1.4` (npm), upstream https://github.com/scoriiu/fenshot,
 *   git tag `v0.1.4` at commit `5e68f7a04e1261328572caf74a2d4a44a342a6c7`, MIT.
 *   Asset: `model/chess-tiles-v2.onnx` (the tile classifier).
 * - `onnxruntime-web@1.29.0` (npm), upstream
 *   https://github.com/microsoft/onnxruntime, MIT. Asset:
 *   `ort-wasm-simd-threaded.wasm` (the WebAssembly runtime binary).
 *
 * License texts and attribution: `./NOTICE.md`.
 *
 * A version bump of either package must deliberately re-verify and update
 * `RECOGNIZER_VERSION`/`MODEL_SHA256`/`ORT_WASM_SHA256` together -- never
 * change the hash without also updating the version string, and never
 * change the version string without re-running the hash computation
 * (`certutil -hashfile <file> SHA256` on Windows, `sha256sum <file>`
 * elsewhere) against the newly installed files.
 *
 * Import paths: `@scoriiu/fenshot`'s `package.json` "exports" map publishes
 * the model at the subpath `./model/chess-tiles-v2.onnx`, so the plain
 * `?url` bare-specifier import below resolves correctly. `onnxruntime-web`'s
 * "exports" map publishes the wasm binary as `./ort-wasm-simd-threaded.wasm`
 * (mapping to `./dist/ort-wasm-simd-threaded.wasm` internally) -- note there
 * is no `dist/` segment in the *importable* specifier; `onnxruntime-web/dist/
 * ort-wasm-simd-threaded.wasm?url` is not in the exports map and fails the
 * build (verified directly: Vite/Rolldown rejects it with "is not exported
 * under the conditions ... from package onnxruntime-web"). Both specifiers
 * were confirmed with a standalone non-lib `vite build` to resolve to
 * separate hashed files under `dist/assets/` (not inlined as base64) at
 * their real byte sizes.
 */
import modelUrl from '@scoriiu/fenshot/model/chess-tiles-v2.onnx?url';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

export { modelUrl, ortWasmUrl };

/** Identity string reported in every `RecognitionSuccess.recognizerVersion`. */
export const RECOGNIZER_VERSION = 'fenshot-0.1.4/chess-tiles-v2/ort-web-1.29.0';

/** SHA-256 of `@scoriiu/fenshot`'s `model/chess-tiles-v2.onnx` at 0.1.4. */
export const MODEL_SHA256 = '883f6a8e639e6d6b6399b3fda0508ad772e3c6f9cefa2e678a13f27b9fa6248d';

/** SHA-256 of `onnxruntime-web`'s `dist/ort-wasm-simd-threaded.wasm` at 1.29.0. */
export const ORT_WASM_SHA256 = 'ec8580a9d7b9476ceee52e10a7f94124e4dc71a019d666ed6d4726697c109a4d';
