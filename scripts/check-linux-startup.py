"""Require fresh native and frontend startup from the extracted Linux package."""
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

binary = Path(sys.argv[1]).resolve(strict=True)
with tempfile.TemporaryDirectory(prefix="lector-linux-startup-") as temporary:
    environment = os.environ.copy()
    for name in ("XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME"):
        environment[name] = str(Path(temporary) / name.lower())
        Path(environment[name]).mkdir()
    log = Path(environment["XDG_DATA_HOME"]) / "org.lectorlibre.reader/logs/lector-libre.jsonl"
    started = time.time_ns() // 1_000_000
    process = subprocess.Popen([str(binary)], env=environment)
    try:
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError(f"Native app exited early: {process.returncode}")
            events = []
            if log.exists():
                for line in log.read_text().splitlines():
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if event.get("pid") == process.pid and event.get("timeUnixMs", 0) >= started:
                        events.append(event["event"])
            if any(event in events for event in ("frontend.error", "frontend.rejection")):
                raise RuntimeError("Frontend reported an error during startup")
            if "performance.startup_ms" in events:
                print(json.dumps({"nativeStartup": True, "frontendStartup": True, "events": events}))
                break
            time.sleep(1)
        else:
            raise RuntimeError("No fresh frontend startup event within 45 seconds")
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
