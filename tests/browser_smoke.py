"""Optional browser check. Requires Python Playwright and an installed Chromium browser.
This dependency is for testing only. The game and Node build do not need it.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--chromium", default="/usr/bin/chromium")
parser.add_argument("--headed", action="store_true")
parser.add_argument(
    "--url", help="Test the hosted build at an HTTP(S) URL instead of the offline file"
)
parser.add_argument("--output", type=Path, default=ROOT / "test-results")
args = parser.parse_args()
output = args.output
output.mkdir(parents=True, exist_ok=True)
checks: list[dict] = []
errors: list[str] = []
external: list[str] = []
report: dict = {}


def check(name: str, passed: bool) -> None:
    checks.append({"name": name, "result": "PASS" if passed else "FAIL"})
    print(("PASS" if passed else "FAIL") + " / " + name, flush=True)
    if not passed:
        raise AssertionError(name)


with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path=args.chromium,
        headless=not args.headed,
        args=[
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
        ],
    )
    context = browser.new_context(
        viewport={"width": 1440, "height": 900},
        offline=not bool(args.url),
        accept_downloads=True,
    )
    context.set_default_timeout(8000)
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    html = (ROOT / "index.html").read_text()
    virtual = "https://g-zero.test/?debug&renderer=webgl2"
    local_target = (ROOT / "index.html").as_uri() + "?debug&renderer=webgl2"

    def route_request(route):
        if route.request.url == local_target:
            route.continue_()
        elif route.request.url == virtual:
            route.fulfill(
                status=200, content_type="text/html; charset=utf-8", body=html
            )
        else:
            external.append(route.request.url)
            route.abort()

    if not args.url:
        context.route("**/*", route_request)
    allowed_origin = urlsplit(args.url).netloc if args.url else None
    page.on(
        "request",
        lambda req: (
            external.append(req.url)
            if req.url.startswith(("http:", "https:"))
            and req.url != virtual
            and urlsplit(req.url).netloc != allowed_origin
            else None
        ),
    )
    try:
        target = args.url.rstrip("/") if args.url else (ROOT / "index.html").as_uri()
        page.goto(
            target + "/?debug&renderer=webgl2"
            if args.url
            else target + "?debug&renderer=webgl2",
            wait_until="domcontentloaded",
            timeout=15000,
        )
        method = (
            "Hosted build over HTTP(S), same-origin assets"
            if args.url
            else "Direct file:// navigation, network disabled"
        )
    except Exception as error:
        if args.url:
            raise
        report["localFileLimit"] = str(error).splitlines()[0]
        page.close()
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on(
            "request",
            lambda req: (
                external.append(req.url)
                if req.url.startswith(("http:", "https:"))
                else None
            ),
        )
        # Supply only the test query options when managed browsers block navigation.
        # The delivered HTML and all embedded engine bytes remain unchanged.
        page.evaluate(
            "() => { window.URLSearchParams = class extends URLSearchParams { constructor(value) { super(value === '' ? '?debug&renderer=webgl2' : value); } }; }"
        )
        page.set_content(html, wait_until="domcontentloaded")
        method = "Unchanged HTML loaded in memory, network disabled; test query options injected"
    try:
        deadline = time.monotonic() + 45
        while not page.evaluate(
            "window.GameBoot && ['RUN','FAIL'].includes(GameBoot.machine.state)"
        ):
            if time.monotonic() > deadline:
                raise AssertionError(
                    "Startup did not reach a terminal state: "
                    + page.locator("#gb-state").inner_text()
                )
            time.sleep(0.1)
        boot = page.evaluate("GameBoot.report()")
        report.update({"browser": browser.version, "loadMethod": method, "boot": boot})
        check("All required startup stages complete", boot["state"] == "RUN")
        check(
            "The delivery mode matches the tested artifact",
            boot["diagnostics"]["mode"] == ("hosted" if args.url else "offline"),
        )
        check(
            "Eight boot stages precede the game",
            len(boot["stages"]) == 8
            and all(s["status"] in ["OK", "WARN"] for s in boot["stages"]),
        )
        check(
            "The boot diagnostics identify g-zero 0.5.1",
            boot["game"]["name"] == "g-zero" and boot["game"]["version"] == "0.5.1",
        )
        check("The browser title identifies g-zero", page.title().startswith("g-zero"))
        check(
            "The visible menu uses the new name",
            page.locator("h1.title").inner_text().replace("\n", "") == "g-zero",
        )
        check(
            "The actual renderer is WebGL2",
            "WEBGL2" in boot["diagnostics"]["renderer"].upper(),
        )
        check(
            "The actual Rapier version is 0.19.3",
            boot["diagnostics"]["engines"]["rapierWasm"] == "0.19.3",
        )
        check(
            "The image orientation and first frame pass",
            boot["diagnostics"]["tests"]["firstFrame"]["result"] == "PASS",
        )
        check(
            "The new debug name is available",
            page.evaluate('typeof GZERO.getState === "function"'),
        )
        page.screenshot(path=str(output / "menu.png"))
        page.locator("#start").click()
        start = page.evaluate("GZERO.getState()")
        racers = page.evaluate("GZERO.getRacers()")
        check(
            "The player starts in position 100 of 101",
            start["rank"] == 100 and start["racerCount"] == 101,
        )
        check(
            "There are 100 uniquely named opponents",
            len(racers) == 100 and len({r["name"] for r in racers}) == 100,
        )
        check(
            "There are 99 opponents ahead and one behind",
            sum(r["distance"] > start["raceDistance"] for r in racers) == 99
            and sum(r["distance"] < start["raceDistance"] for r in racers) == 1,
        )
        check(
            "Magnetic lock and the wide two-lane track are unchanged",
            start["magneticLock"]
            and start["trackWidth"] == 108
            and start["lanes"] == 2,
        )
        check(
            "The normal and boost speed targets are unchanged",
            start["topSpeed"] == 516 and start["boostSpeed"] == 732,
        )
        page.screenshot(path=str(output / "grid.png"))
        driven = page.evaluate(
            "GZERO.debug.step(1800,{throttle:true,boost:true},true).state"
        )
        check(
            "Actual physics advances the player",
            driven["raceDistance"] > start["raceDistance"] + 100,
        )
        check(
            "All opponents move in the actual simulation",
            len(page.evaluate("GZERO.getRacers()")) == 100
            and all(
                r["distance"] > racers[i]["distance"]
                for i, r in enumerate(page.evaluate("GZERO.getRacers()"))
            ),
        )
        check(
            "Magnetic height remains correct",
            abs(driven["clearance"] - driven["magneticHeight"]) < 0.0001,
        )
        check(
            "The player remains inside the road edges",
            abs(driven["lateralOffset"]) <= driven["edgeLimit"] + 0.0001,
        )
        check("No automatic recovery occurred", driven["recoveries"] == 0)
        page.screenshot(path=str(output / "race.png"))
        page.evaluate("GameBoot.show(); GZERO.halt(); GZERO.run()")
        paused = page.evaluate("GZERO.getState()")
        check("Diagnostics pause the race", paused["mode"] == "paused")
        with page.expect_download() as download_info:
            page.locator("#gb-save").click()
        download = download_info.value
        download.save_as(str(output / "saved-report.json"))
        check(
            "Saved diagnostics use the new game name",
            download.suggested_filename.startswith("g-zero-"),
        )
        check(
            "The failure and runtime report retain 101 racers",
            json.loads((output / "saved-report.json").read_text())["gameState"][
                "racerCount"
            ]
            == 101,
        )
        page.locator("#gb-close").click()
        page.locator("#restart").click()
        check(
            "Restart restores position 100",
            page.evaluate("GZERO.getState().rank") == 100,
        )
        page.set_viewport_size({"width": 390, "height": 844})
        check(
            "The mobile viewport has no horizontal overflow",
            page.evaluate("document.documentElement.scrollWidth <= innerWidth"),
        )
        check("No uncaught browser errors occurred", not errors)
        check("No external resource requests occurred", not external)
    finally:
        report.update(
            {"checks": checks, "errors": errors, "externalRequests": external}
        )
        (output / "browser-results.json").write_text(json.dumps(report, indent=2))
        browser.close()
print(
    json.dumps(
        {
            "checks": len(checks),
            "passed": sum(c["result"] == "PASS" for c in checks),
            "loadMethod": report["loadMethod"],
            "externalRequests": external,
            "errors": errors,
        },
        indent=2,
    )
)
