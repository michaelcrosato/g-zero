# Third-party code

## Engine versions

| Component | Version | Local file | License |
| --- | --- | --- | --- |
| Three.js core | 0.181.0 / r181 | `vendor/three.core.min.js` | MIT |
| Three.js WebGPU and WebGL2 backend | 0.181.0 / r181 | `vendor/three.webgpu.min.js` | MIT |
| Rapier 3D compatibility module and embedded WebAssembly | 0.19.3 | `vendor/rapier.mjs` | Apache-2.0 |

These three files were retained byte-for-byte from the delivered ION CIRCUIT magnetic build. They are the bundled compatibility modules used by this game, not complete npm package tarballs. The Three.js module headers describe their build-artifact origin. No new engine download or version change was made for the g-zero rename.

`vendor/manifest.json` records each file's size, version, and SHA-256. The build rejects a file that does not match. The boot loader also verifies payload integrity and checks the engine versions at runtime.

Full license text is in `licenses/Three-MIT.txt` and `licenses/Apache-2.0.txt`. It is also embedded in the standalone HTML. The game's original MIT notice is retained in `LICENSE`, with the new project name added.

Do not remove upstream attribution or treat the retained engine modules as newly authored game code.
