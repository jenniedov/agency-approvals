#!/usr/bin/env python3
"""The Mac side: Claude uses this to talk to the agency site. Standard library only (python3, no pip).

Reads the site address and AGENT_TOKEN from .secrets/site.json at the agency folder root:
  {"url": "https://<name>.<account>.workers.dev", "agent_token": "..."}

  agent.py beat ["what I'm doing"]
  agent.py inbox                          open comments and posts with changes requested
  agent.py client '{"name":..,"handle":..,"profile_url":..,"avatar":..,"bio":..}'
  agent.py clients
  agent.py post <client_id> "<title>" [--kind reel|story|short|long|post] [--caption "..."]
  agent.py upload <post_id> <video file> [--note "what changed"]     new version → appears in For You
  agent.py caption <post_id> "<text>"
  agent.py cover <post_id> <image file>   |   agent.py cover-time <post_id> <seconds>
  agent.py done <comment_id> ["what I did"]
  agent.py secrets                        ElevenLabs key for transcription (kept in memory, never printed)
"""
import json, os, subprocess, sys, time, urllib.request, urllib.error

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CONF = os.path.join(ROOT, ".secrets", "site.json")


def conf():
    if not os.path.exists(CONF):
        sys.exit(f"missing {CONF} (the installer writes it)")
    return json.load(open(CONF))


def call(method, path, data=None, raw=None, ctype=None):
    c = conf()
    body = raw if raw is not None else (json.dumps(data).encode() if data is not None else None)
    req = urllib.request.Request(c["url"].rstrip("/") + "/api/agent" + path, data=body, method=method)
    req.add_header("authorization", "Bearer " + c["agent_token"])
    if body is not None:
        req.add_header("content-type", ctype or "application/json")
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {path} → {e.code} {e.read()[:400].decode(errors='replace')}")


def probe(path):
    try:
        out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                              "stream=width,height:format=duration", "-of", "json", path],
                             capture_output=True, text=True, timeout=30).stdout
        d = json.loads(out)
        s = d["streams"][0]
        return float(d["format"]["duration"]), s["width"], s["height"]
    except Exception:
        return None, None, None


def upload(post_id, path, note=None):
    post_id = int(post_id)
    dur, w, h = probe(path)
    v = call("POST", "/bunny/video", {"title": f"{post_id}-{os.path.basename(path)}"})
    size = os.path.getsize(path)
    print(f"uploading {size // 1024 // 1024} MB to Bunny…", file=sys.stderr)
    with open(path, "rb") as f:
        req = urllib.request.Request(v["upload_url"], data=f, method="PUT")
        for k, val in v["headers"].items():
            req.add_header(k, val)
        req.add_header("content-type", "application/octet-stream")
        req.add_header("content-length", str(size))
        urllib.request.urlopen(req, timeout=3600).read()
    # wait until Bunny has finished encoding (status 4), up to 10 minutes
    for _ in range(120):
        info = call("GET", f"/bunny/video/{v['guid']}")
        if info.get("status") == 4:
            break
        if info.get("status") in (5, 6):
            sys.exit(f"Bunny failed to encode (status {info.get('status')})")
        time.sleep(5)
    else:
        print("still encoding after 10 minutes; registering anyway", file=sys.stderr)
    dur = dur or info.get("length")
    w = w or info.get("width")
    h = h or info.get("height")
    r = call("POST", f"/posts/{post_id}/versions", {"bunny_guid": v["guid"], "duration": dur, "width": w, "height": h, "note": note})
    print(json.dumps(r, ensure_ascii=False))


def opt(args, name, default=None):
    if name in args:
        i = args.index(name)
        val = args[i + 1]
        del args[i:i + 2]
        return val
    return default


def main(a):
    if not a:
        sys.exit(__doc__)
    cmd, a = a[0], a[1:]
    out = None
    if cmd == "beat":
        out = call("POST", "/beat", {"machine": os.uname().nodename, "detail": a[0] if a else None})
    elif cmd == "inbox":
        out = call("GET", "/inbox")
    elif cmd == "client":
        out = call("POST", "/clients", json.loads(a[0]))
    elif cmd == "clients":
        out = call("GET", "/clients")
    elif cmd == "post":
        kind = opt(a, "--kind", "reel")
        caption = opt(a, "--caption")
        out = call("POST", "/posts", {"client_id": a[0], "title": a[1], "kind": kind, "caption": caption,
                                      "orientation": "horizontal" if kind == "long" else "vertical"})
    elif cmd == "upload":
        note = opt(a, "--note")
        return upload(a[0], a[1], note)
    elif cmd == "caption":
        out = call("PATCH", f"/posts/{int(a[0])}", {"caption": a[1]})
    elif cmd == "cover":
        ct = "image/png" if a[1].lower().endswith(".png") else "image/jpeg"
        out = call("POST", f"/posts/{int(a[0])}/cover", raw=open(a[1], "rb").read(), ctype=ct)
    elif cmd == "cover-time":
        out = call("PATCH", f"/posts/{int(a[0])}", {"cover_time": float(a[1])})
    elif cmd == "done":
        out = call("POST", f"/comments/{int(a[0])}/done", {"note": a[1] if len(a) > 1 else None})
    elif cmd == "secrets":
        k = call("GET", "/secrets").get("elevenlabs_key")
        print("elevenlabs key: " + ("set" if k else "not set"))
        return
    else:
        sys.exit(__doc__)
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
