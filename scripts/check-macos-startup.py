"""Check a fresh macOS runner's native app and frontend startup, without importing books."""
import json
import subprocess
import sys
import time
from pathlib import Path

app = Path(sys.argv[1]).resolve(strict=True)
binary = app / "Contents/MacOS/lector-libre"
subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)
log = Path.home() / "Library/Application Support/org.lectorlibre.reader/logs/lector-libre.jsonl"
started = time.time_ns() // 1_000_000
process = subprocess.Popen([str(binary)])
try:
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Native app exited early: {process.returncode}")
        if log.exists():
            events = []
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
        raise RuntimeError("No fresh frontend startup event within 40 seconds")
finally:
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
