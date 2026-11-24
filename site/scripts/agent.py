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
                                          (Bunny library if the site has one, otherwise the site's own R2 bucket)
  agent.py approved [--all] [--kind story]   posts whose video is approved (not yet scheduled; --all = also scheduled/published)
  agent.py texts <post_id>                text captions Jennie placed on a story (JSON list), to bake into the video before posting.
                                          Also in `approved` output as the `texts` field of each post. Per text:
                                          text (Hebrew, RTL, may contain newlines), style (white-box = white rounded box + black text,
                                          black-box = black rounded box + white text, shadow = white text with a soft shadow),
                                          x, y = CENTRE of the box in percent of a 1080x1920 frame (50,50 = middle), width_pct = MAX box width (box shrink-wraps the text; padding included) in
                                          percent of the 1080 width, font_px_at_1080 = font size in px on the 1080 px wide frame,
                                          rotation in degrees. Font Heebo ExtraBold (800), centred, line-height 1.25; box padding .22em .5em, radius .4em
  agent.py download <post_id> [out.mp4]   the current version's file of a post
  agent.py mark-scheduled <post_id> [--at 2026-11-25T18:00:00+02:00]   stage → scheduled
  agent.py storage                        where videos go: {"bunny": bool, "r2": bool}
  agent.py caption <post_id> "<text>"
  agent.py cover-options <post_id> <img> [<img> …] [--note "..."]   cover options she picks from (make them with make_covers.py)
  agent.py cover <post_id> <image file>   |   agent.py cover-time <post_id> <seconds>
  agent.py done <comment_id> ["what I did"]
  agent.py secrets                        ElevenLabs key for transcription (kept in memory, never printed)
"""
import base64, json, os, subprocess, sys, tempfile, time, urllib.parse, urllib.request, urllib.error

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CONF = os.environ.get("AGENT_CONF") or os.path.join(ROOT, ".secrets", "site.json")  # AGENT_CONF: another site (e.g. local dev)


def conf():
    if not os.path.exists(CONF):
        sys.exit(f"missing {CONF} (the installer writes it)")
    return json.load(open(CONF))


def call(method, path, data=None, raw=None, ctype=None):
    c = conf()
    body = raw if raw is not None else (json.dumps(data).encode() if data is not None else None)
    req = urllib.request.Request(c["url"].rstrip("/") + "/api/agent" + path, data=body, method=method)
    req.add_header("authorization", "Bearer " + c["agent_token"])
    req.add_header("user-agent", "agency-approvals-agent/1.0")  # Cloudflare blocks Python's default agent (error 1010)
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


def put_file(url, path, headers):
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        req = urllib.request.Request(url, data=f, method="PUT")
        req.add_header("user-agent", "agency-approvals-agent/1.0")
        for k, val in headers.items():
            req.add_header(k, val)
        req.add_header("content-length", str(size))
        try:
            with urllib.request.urlopen(req, timeout=3600) as r:
                return json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            sys.exit(f"PUT {url.split('?')[0]} → {e.code} {e.read()[:400].decode(errors='replace')}")
        except json.JSONDecodeError:
            return {}


def upload_r2(post_id, path, note=None):
    """No Bunny library: the file goes into the site's R2 bucket through the Worker."""
    dur, w, h = probe(path)
    c = conf()
    size = os.path.getsize(path)
    if size > 100 * 1024 * 1024:
        sys.exit("file over 100 MB: the Worker cannot take it in one piece (compress it first)")
    print(f"uploading {size // 1024 // 1024} MB to the site (R2)…", file=sys.stderr)
    url = c["url"].rstrip("/") + "/api/agent/r2/upload?name=" + urllib.parse.quote(os.path.basename(path))
    r = put_file(url, path, {"authorization": "Bearer " + c["agent_token"], "content-type": "application/octet-stream",
                             "x-content-type": "video/quicktime" if path.lower().endswith(".mov") else "video/mp4"})
    if not r.get("guid"):
        sys.exit(f"upload failed: {r}")
    out = call("POST", f"/posts/{post_id}/versions", {"bunny_guid": r["guid"], "duration": dur, "width": w, "height": h, "note": note})
    print(json.dumps(out, ensure_ascii=False))


def upload(post_id, path, note=None):
    post_id = int(post_id)
    if not os.path.isfile(path):
        sys.exit(f"no such file: {path}")
    st = call("GET", "/storage")
    if not st.get("bunny"):
        if not st.get("r2"):
            sys.exit("the site has no Bunny library and no R2 bucket: add the Bunny key in the settings screen")
        return upload_r2(post_id, path, note)
    dur, w, h = probe(path)
    v = call("POST", "/bunny/video", {"title": f"{post_id}-{os.path.basename(path)}"})
    size = os.path.getsize(path)
    print(f"uploading {size // 1024 // 1024} MB to Bunny…", file=sys.stderr)
    with open(path, "rb") as f:
        req = urllib.request.Request(v["upload_url"], data=f, method="PUT")
        req.add_header("user-agent", "agency-approvals-agent/1.0")
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


def data_url(path):
    """JPEG data URL under ~1 MB; big images are shrunk with sips (Mac) first."""
    if os.path.getsize(path) > 900_000 or not path.lower().endswith((".jpg", ".jpeg")):
        tmp = os.path.join(tempfile.mkdtemp(), "c.jpg")
        subprocess.run(["sips", "-Z", "1440", "-s", "format", "jpeg", "-s", "formatOptions", "80", path, "--out", tmp],
                       check=True, capture_output=True)
        path = tmp
    return "data:image/jpeg;base64," + base64.b64encode(open(path, "rb").read()).decode()


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
    elif cmd == "cover-options":
        note = opt(a, "--note")
        out = [call("POST", f"/posts/{int(a[0])}/cover-options",
                    {"image": data_url(f), "note": note or os.path.basename(f), "notify": i == len(a) - 2})
               for i, f in enumerate(a[1:])]
    elif cmd == "cover-time":
        out = call("PATCH", f"/posts/{int(a[0])}", {"cover_time": float(a[1])})
    elif cmd == "done":
        out = call("POST", f"/comments/{int(a[0])}/done", {"note": a[1] if len(a) > 1 else None})
    elif cmd == "storage":
        out = call("GET", "/storage")
    elif cmd == "approved":
        q = []
        if "--all" in a:
            a.remove("--all"); q.append("all=1")
        kind = opt(a, "--kind")
        if kind:
            q.append("kind=" + urllib.parse.quote(kind))
        out = call("GET", "/approved" + ("?" + "&".join(q) if q else "")).get("posts", [])
    elif cmd == "texts":
        out = call("GET", f"/posts/{int(a[0])}/texts").get("texts", [])
    elif cmd == "download":
        pid = int(a[0])
        posts = call("GET", "/approved?all=1").get("posts", [])
        post = next((p for p in posts if p["id"] == pid), None)
        if not post or not post.get("download_url"):
            sys.exit(f"post {pid}: no approved video with a file")
        dest = a[1] if len(a) > 1 else f"{pid}-{post['client_id']}-v{post.get('version_n') or 1}.mp4"
        c = conf()
        req = urllib.request.Request(post["download_url"])
        req.add_header("user-agent", "agency-approvals-agent/1.0")
        if post["download_url"].startswith(c["url"].rstrip("/") + "/api/agent/"):
            req.add_header("authorization", "Bearer " + c["agent_token"])
        with urllib.request.urlopen(req, timeout=600) as r, open(dest, "wb") as f:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)
        print(json.dumps({"post": pid, "file": os.path.abspath(dest), "bytes": os.path.getsize(dest)}, ensure_ascii=False))
        return
    elif cmd == "mark-scheduled":
        at = opt(a, "--at")
        out = call("POST", f"/posts/{int(a[0])}/scheduled", {"at": at})
    elif cmd == "secrets":
        k = call("GET", "/secrets").get("elevenlabs_key")
        print("elevenlabs key: " + ("set" if k else "not set"))
        return
    else:
        sys.exit(__doc__)
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
