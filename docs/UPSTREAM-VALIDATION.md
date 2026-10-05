> Historical evidence for ION CIRCUIT 0.5.0, before the g-zero rename.
> These results are not a new test run for this repository.

# ION CIRCUIT — Magnetic Grand Prix validation

Build: `IC-005-F1AC744D62`  
Game version: `0.5.0`  
File: `ION-CIRCUIT-MAGNETIC-101.html`  
Size: 3,600,703 bytes  
SHA-256: `65e799adeeb7e734da8b844f648e3484cd6427bd260120e16249a1ba72de62b9`

## Changes

The player and all opponents stay at a fixed height above the road. The game uses the actual road triangles for this constraint. Vertical collision forces cannot cause flight. Both edges contain the complete craft. There is no automatic lane centering. The player still controls steering, acceleration, braking, and boost.

The field has 100 opponents plus the player: 101 racers in total. Each start and restart puts the player in position 100. There are 99 opponents ahead and one behind. The two-column grid has space between the craft. Each opponent has a unique name, its own progress, and a target speed. Same-lane spacing prevents the field from collecting at one point. Distant opponents remain in the simulation when their images are not drawn.

The position display, result screen, menu, help text, and saved boot report use the new field size. The R key now aligns the player at the current location. It retains the three-second penalty. Magnetic runs use a separate local best-lap record.

## Results

All 44 browser checks and 11 geometry test groups passed. A final static audit also passed.

The browser tests used the real embedded Three.js r181 WebGL2 renderer and the real Rapier 0.19.3 WebAssembly engine. Both browser contexts had network access disabled. There were no external resource requests. Both cold starts completed all eight boot stages. Real graphics checks confirmed upright output. No uncaught script errors occurred.

The tests checked keyboard movement, countdown, exact grid position, all 100 moving opponents, overtaking, actual opponent contact, pause, resume, restart, diagnostics, and a saved local report. Three-digit positions 001, 100, and 101 were checked. A damaged payload stopped startup before gameplay.

The motion tests applied large upward, downward, and outward velocities. They used twelve track regions, including banks, hills, and the finish seam. They also held each steering direction with boost and air brakes for ten simulated seconds. The largest measured player height error in 52 recorded stress samples was 0.00001002 meters. The maximum absolute lateral coordinate was 47.00 meters. The edge limit is 47 meters from the center of the 108-meter-wide road. No automatic recovery occurred.

A complete three-lap test run finished in 34.97 simulated seconds with no fall or automatic recovery. The test driver aligned the heading to the local track direction. This was a test input, not an added steering aid in normal play. Separate tests checked manual steering.

The geometry tests checked the surface against the rendered mesh, vertical-force rejection, both edge limits, free lateral movement, grid spacing, and eight fast laps across the closed track seam. The constraints use unwrapped track distance, so they do not select a different road section at a crossing.

Desktop and mobile-sized screenshots were inspected. The game filled the window. The mobile page had no horizontal overflow.

## Offline package audit

All five embedded payload checksums and byte counts passed. The view checksum passed. The Three.js and Rapier payloads are unchanged from the previous file. Their licenses remain embedded. No external script or style file is required. The content security policy blocks external connections. This HTML is the complete game, not a builder. No second export step is required.

## Test limits

The test browser blocks `file://` navigation by administrator policy. The delivered HTML was therefore loaded unchanged into browser memory with networking disabled. Direct local-file launch remains unverified here. This does not add a server requirement to the game.

Real WebGPU hardware, Firefox, Safari, physical mobile devices, and low-end device performance were not tested. The mobile checks used a 390 × 844 browser viewport with touch enabled. The desktop checks used 1440 × 900. The browser was Chromium 144 with SwiftShader and an Xvfb display.

## Browser check record

PASS — The complete embedded game reaches RUN offline
PASS — All 8 startup stages complete before gameplay
PASS — Real WebGL2, Three r181 and Rapier 0.19.3 are active
PASS — Real engine self-tests and first-frame check pass
PASS — Startup has no uncaught script errors
PASS — Menu describes 100 rivals and grid position 100 of 101
PASS — Start button begins countdown at rank 100 of 101
PASS — Exactly 99 opponents start ahead and one starts behind
PASS — The field has exactly 100 uniquely named opponents
PASS — All ship indices are valid through first rendering
PASS — Three-times speed and the wide two-lane track remain
PASS — Player starts at the magnetic height inside the edges
PASS — Real keyboard and animation loop advance the race
PASS — Pause freezes race time and movement
PASS — Resume returns to racing
PASS — Restart restores rank 100 and all initial opponent positions
PASS — All 100 opponents advance under real Rapier physics
PASS — The player can gain places from the rear of the grid
PASS — All opponents remain at the magnetic height
PASS — Collisions and overtaking have not caused a fall
PASS — Left edge rejects forced outward and upward velocity
PASS — Left held steering plus boost stays on the track for 10 seconds
PASS — Right edge rejects forced outward and upward velocity
PASS — Right held steering plus boost stays on the track for 10 seconds
PASS — Twelve track regions reject vertical impulses at boost speed
PASS — Actual opponent collision is registered
PASS — Actual opponent collision cannot launch the player
PASS — A complete three-lap race finishes
PASS — The full race stays attached with zero automatic recoveries
PASS — Finish classification uses 101 racers and a three-digit position
PASS — All three lap times are recorded
PASS — Last place displays as position 101 without a leading extra zero
PASS — Boot diagnostics pause the race
PASS — Offline saved report includes magnetic lock and all 101 racers
PASS — Restart after diagnostics restores position 100
PASS — No external resource requests during desktop gameplay
PASS — No uncaught errors during desktop gameplay
PASS — A second cold offline load starts on a mobile-sized display
PASS — Automatic renderer fallback remains available
PASS — Mobile page has no horizontal overflow
PASS — Mobile start position is also 100 of 101
PASS — Mobile view has no external requests or script errors
PASS — A damaged payload stops startup before game creation
PASS — Damaged-payload failure has no external request
