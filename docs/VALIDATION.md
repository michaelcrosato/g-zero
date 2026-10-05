# g-zero 0.5.1 — source release validation

Build: `GZ-0051-1E626A55F0`  
Playable file: `index.html` / `g-zero.html`  
Size: 3,600,274 bytes  
SHA-256: `d7273304e02d09af3ee4b74a7fc18513e87f35f953a634958280e7542821bd08`

## Changes in this release

The game was renamed from ION CIRCUIT to g-zero. The browser title, menu, boot diagnostics, package name, and saved report filename now use g-zero. The static boot version and build labels match the runtime configuration.

The current magnetic game was extracted into readable source modules. The package includes a deterministic build, the exact embedded engine modules, license text, unit tests, and an optional browser smoke test. No engine version, game tuning, magnetic constraint, opponent count, grid position, or track geometry was changed. The old local record key and debug alias remain for compatibility.

The obsolete runtime builder branch was removed. The exported HTML is the complete game. It does not download engines or ask the player to create a second file.

## Checks run for this release

**80 Node tests passed.** These include boot order, first-failure retention, timeouts, cancellation, startup gating, race logic, course geometry, magnetic lock, the exact 100-opponent grid, payload integrity, license inclusion, and build reproducibility.

**26 browser checks passed.** They used the real embedded Three.js r181 WebGL2 backend and Rapier 0.19.3. All eight startup stages completed. The actual four-corner graphics check and first frame passed. The visible g-zero menu was inspected.

The browser checks confirmed starting position 100 of 101, 99 opponents ahead, one behind, 100 unique moving opponents, unchanged speed targets, the 108-meter two-lane track, player motion, fixed magnetic height, edge containment, zero automatic recoveries in the tested run, diagnostics pause, saved reports, restart, and mobile viewport width.

No uncaught browser errors or external resource requests occurred. The browser context had network access disabled. The source and vendored engine bytes in the tested HTML were unchanged; the harness supplied only debug and forced-WebGL2 query options for its in-memory test.

The build was checked against the committed output and repeated to verify identical bytes, build ID, and SHA-256. The final source ZIP was also rebuilt and tested after extraction.

## Evidence

- `verification/node-tests.txt`: the Node check output.
- `verification/browser-tests.txt`: the browser test output.
- `verification/browser-results.json`: the boot report and individual checks.
- `images/menu.png`, `images/grid.png`, and `images/race.png`: screenshots from the renamed game.

`UPSTREAM-VALIDATION.md` is historical evidence for ION CIRCUIT 0.5.0. It is not presented as a new test run.

## Test limits

The managed browser rejected direct `file://` navigation. The test therefore loaded the complete HTML into browser memory. It did not use a local HTTP server. Direct local-file opening remains unverified in this environment.

The test used Chromium 144.0.7559.96 with SwiftShader on Linux and a virtual display. Real WebGPU hardware, Firefox, Safari, physical touch devices, and low-end hardware performance were not tested for this rename. Mobile verification used a 390 × 844 viewport, not a physical phone.

The GitHub Actions workflow is included but has not been executed on GitHub. No remote repository was created or updated during this export.
