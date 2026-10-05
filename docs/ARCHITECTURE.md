# Architecture

## Single-file runtime

`index.html` contains classic boot scripts, inert JSON engine payloads, inert game interface data, and a small module coordinator. The coordinator verifies the embedded checksums and makes local Blob module URLs. The WebGPU module's core import is changed to the local core Blob URL. Rapier contains its WebAssembly bytes. No module is fetched from a CDN.

The saved file uses `connect-src 'none'`. The browser still controls graphics, storage, fullscreen, audio, and local-file policy. A single HTML file cannot override those platform rules.

## Hosted runtime

`dist/index.html` retains the boot screen, diagnostics, interface data, and licenses. Its engine payload descriptors point to five content-hashed files in `dist/assets/`. During B10 the loader fetches those files concurrently from the same origin, checks their pinned versions and runtime checksums, and then uses the same Blob module pipeline as the offline game. A missing or damaged asset stops startup with a diagnostic code. B10 allows up to 60 seconds for a first download and cancels pending requests if startup fails.

Vercel revalidates HTML and build metadata on every visit. Hashed assets can be cached for a year and reused across releases when their contents are unchanged. Only `dist/` is published. The complete offline copy remains available at `/g-zero.html`; saving the smaller hosted HTML alone does not include the engine files. See [deployment settings](VERCEL.md).

## Source and build

The readable game modules live in `src/`. The small build script removes single-line imports and named declaration exports, then joins the known modules into two local payloads. It is not a general JavaScript bundler. It rejects unsupported module syntax so an added import cannot silently become a runtime download.

`vendor/manifest.json` records the exact retained engine files. The build checks their SHA-256 values and byte lengths. Runtime data uses the same UTF-16 FNV checksum implementation as GAMEBOOT/1. The build ID also includes every runtime source and license. No timestamp or host path affects the output.

## Boot

The startup sequence remains B00, B10, B20, B30, B40, B50, B60, and B70. The classic emergency handler runs first. The game interface is inert until B50. Rendering, physics, image orientation, and the first frame must pass before the loop starts.

The boot code retains the original failure and the stage where it occurred. Time limits and stop checks prevent a late result from starting later stages. Resource cleanup is safe to repeat. The diagnostic report contains the game state when it is available. Optional storage, audio, or fullscreen failures do not block a playable game.

The obsolete builder-only branch was removed from `boot/view.js`. This repository has no runtime download-and-export process.

## Renderer

The renderer uses Three.js r181's WebGPU-first renderer with its node-based WebGL2 backup. The same pixel pass is used by both. A low-resolution render target, nearest-neighbor filtering, color quantization, dithering, a low chase camera, and billboard ships produce the retro appearance.

The pixel output uses QuadMesh. Before gameplay, the boot check compares four image corners and the final screen orientation. It stops with a diagnostic code rather than showing an inverted or blank game.

## Physics and magnetic lock

The simulation uses Rapier 0.19.3 at a fixed 1/240-second step, with a cap on catch-up steps. The player is a dynamic body. Opponents use kinematic bodies.

Each track segment has two road triangles and a pair of dual surface axes. The magnetic constraint projects the body's motion into longitudinal and lateral deck coordinates. It discards normal displacement and returns the body to a fixed height above the same surface. The unwrapped longitudinal coordinate retains the correct road section at crossings and lap seams.

The lateral coordinate is bounded at 47 meters from the center of the 108-meter road. This leaves clearance for the full craft. At an edge, the constraint removes outward velocity but retains inward movement and manual steering. It does not pull the craft toward a lane or the center line.

## Field and ranking

The two-column grid has 101 slots. The player occupies slot 100. Opponents occupy slots 1–99 and 101. Ranking uses unwrapped race distance. The 100 opponents have separate names, positions, progress, speeds, and finish times. Distant opponents can be hidden from drawing but remain in the simulation.

Same-lane spacing limits opponent overlap. Opponents follow the course; the player retains manual steering. The optional light assist changes heading only.

## Debug and records

Add `?debug` to expose `window.GZERO`. Its test functions can advance the simulation, place the player, or set up a contact. They are for tests, not the normal driving controller. A test that calls `debug.step()` must restore the animation loop or supply heartbeats because that method stops scheduled frames while stepping.

The legacy local-storage key and the `window.ION` debug alias remain for compatibility. New boot reports and visible branding use `g-zero`.
