# GAMEBOOT/1

Loader version 1.0.0. Fixed startup order. Per-game hooks.

## Sequence

Percentages mean completed stages. They are not estimates of elapsed time.
Startup duration varies by device. No delay is added to simulate work.

| Code | Hook | Stage | Percent after success | Time limit |
| --- | --- | --- | --- | --- |
| B00 | `core` | Boot core and package mode | 5% | 5 s |
| B10 | `capabilities` | Required platform and payload checks | 15% | 10 s |
| B20 | `renderer` | Select and initialize the graphics backend | 40% | 45 s |
| B30 | `physics` | Initialize physics and embedded WASM | 55% | 30 s |
| B40 | `verify` | Run critical engine self-tests | 65% | 30 s |
| B50 | `prepare` | Load game code, UI, assets, world, and controls | 85% | 30 s |
| B60 | `frame` | Compile shaders and render the first frame | 97% | 45 s |
| B70 | `run` | Start the main loop | 100% | 5 s |

A game that does not need a system must supply the same hook and report that
system as not required. It must not remove or renumber the standard stages.
Game branding comes from configuration. The stages are not branding text.

Stage status is `WAIT`, `WORK`, `OK`, `WARN`, or `FAIL`. Loader state is `IDLE`,
`BOOT`, `RUN`, or `FAIL`. `PACKAGE` and P-codes belong only to the separate
one-time packager; they are not part of the game startup sequence.

## Integration contract

Install the basic HTML/CSS view and classic boot scripts first. Keep the game
DOM empty and inactive. Keep engine and game module sources inert until their
stages. Small coordination code may register hooks before B00.

The state machine calls one hook at a time. A hook can return a value or a
Promise. A required failure must throw an Error with a short `code`, or reject
with that error. Recovered failures and optional-feature failures use `warn`.
The first fatal error stays the primary failure. Later errors remain in the log.

B20 must verify a usable graphics backend, not only the presence of an API.
B40 must test an actual render and a physics step for this game. B50 may mount
the main UI and construct the world only after those checks pass. B60 may draw
the first frame, but must not schedule a recurring game loop. B70 may start the
loop only when `machine.canRun()` is true.

A task boundary before each hook gives the basic view a chance to paint. A
stage timeout prevents later hooks from running. Late asynchronous completion
must not reactivate a failed boot. Per-game asynchronous hooks must use the
active-state check after awaited operations and release unused resources.

On success, reveal the game and retain the report. On failure, stop the game
loop and show the report above the game. Keep the primary code, failing stage,
build, platform, backend, and adapter text visible. Do not use a graphics engine
to draw the failure screen.

## Renderer policy for ION CIRCUIT

Request a WebGPU adapter and device when the browser exposes them in a secure
context. Initialize the actual renderer. If that attempt fails or times out,
record a warning and initialize WebGL2 on a new canvas.

A WebGPU self-test failure also triggers a new WebGL2 attempt at B40. The backup
must pass the same engine test. `?renderer=webgl2` selects WebGL2 directly for
support and comparison tests.

WebGL1 and Canvas2D cannot run this version of the Three.js 3D game. Without
WebGPU or WebGL2, return `RND-NONE`. The plain HTML failure view is the final
fallback. Do not claim that an API label means the game can render.

Adapter names are optional. Report "not exposed" when the browser withholds
them. Do not require a vendor string or bypass browser privacy settings.

Required platform features include modules, the JavaScript features used by
r181, WebAssembly, Blob module URLs, requestAnimationFrame, and Canvas2D for
sprites/HUD. Audio, local storage, native fullscreen, gamepad, and touch input
are optional. Only the available input paths are enabled.

## Self-tests

The physics check creates a temporary Rapier world, body, and collider. It steps
gravity once and requires finite position/velocity and downward motion. It frees
the temporary world afterward.

The graphics check renders four distinct calibration colors. It reads each
corner before and after the final pixel pass. Missing colors give `RND-TEST`.
A changed corner order gives `PIX-FLIP`. A final Canvas2D copy also checks the
screen origin when that copy is available. If the copy is unavailable, the
mandatory render-target readback still must pass. The report records this limit.

B60 checks shader compilation, first draw, and available WebGPU validation
results. These tests check startup viability. They do not replace race testing,
performance measurement, or checks on different browsers and devices.

## Error codes

| Code or family | Meaning |
| --- | --- |
| CAP-JS / CAP-ES | Required JavaScript or module support is unavailable |
| CAP-WASM / WASM-BLOCK | WebAssembly is absent or compilation is blocked |
| CAP-2D | Required 2D canvas could not be created |
| PKG-MISS / PKG-DATA / PKG-HASH | Missing, invalid, or damaged embedded payload |
| VER-THREE / VER-RAPIER | Wrong Three revision or invalid Rapier interface |
| GPU-SKIP / GPU-NO / GPU-INIT / GPU-TIME | WebGPU unavailable or failed; try backup |
| RND-NONE / GL-INIT | No usable renderer, or failed WebGL2 initialization |
| PHY-INIT / PHY-TEST | Physics initialization or self-test failed |
| RND-TEST / RND-TIME / PIX-FLIP | Graphics output or orientation check failed |
| GPU-VAL / GPU-FRAME | WebGPU validation or first-frame error |
| GPU-LOST / GL-LOST | Graphics device or context was lost |
| Bxx-TIME / Bxx-ERR | Stage time limit or uncoded stage error |
| RUN-GATE / RUN-ERR / RUN-STALL | Early loop start, runtime error, or missing frames |
| JS-ERR / JS-REJ | Uncaught script error or unhandled Promise rejection |
| SAVE-OFF / AUD-OFF / FS-OFF | Optional feature unavailable; keep running |
| RND-COPY | Final canvas capture unavailable; see render-target test result |

## Standard report

The report is JSON. Fields include `protocol`, `loaderVersion`, `state`, `stage`,
`progress`, `code`, `message`, `frames`, `elapsedMs`, `stages`, `failure`,
`issues`, `log`, `game`, and `diagnostics`. A running game can add `gameState`.

Each issue contains severity, code, stage, elapsed milliseconds, error name,
message, and available stack. Each stage contains its fixed identity, status,
time limit, start time, and duration. Diagnostics include exact requested engine
versions, observed native version where available, build ID, platform, browser,
context, backend, adapter, feature flags, payload checksums, and test results.
The snapshot is detached from the live machine.

The in-memory event log is limited to 160 entries; the issue list is limited to
80 entries. These bounds prevent repeated errors from consuming unlimited
memory. The separate primary failure remains available. The latest failure can
be saved in local storage. Copy/save controls work without a server. Clipboard
or file-save failure falls back to selectable report text.

Payload checksums use FNV-1a over JavaScript string code units. They detect
accidental corruption. **They are not cryptographic signatures.** Package
selection and source trust remain separate concerns.

## Runtime limits

The loop reports a heartbeat after each successful frame. The watchdog detects
missing frames while the document is visible. It ignores hidden-tab timer
throttling. Device/context loss and runtime exceptions stop the game and reveal
the same report screen.

A JavaScript timer cannot execute while the browser main thread is completely
blocked. It also cannot recover from a browser-process or OS/driver crash.
Timeouts and the heartbeat are safeguards for responsive browser execution, not
a guarantee against every hardware or browser failure. The current stage is
painted before heavy work so it remains available during a stalled operation.

No telemetry, browser fingerprint request, or automatic report upload is added.
The report can still include identifying device detail. The player controls
whether to share it.
