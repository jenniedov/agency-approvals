#!/usr/bin/env python3
"""The Mac side: Claude uses this to talk to the agency site. Standard library only (python3, no pip).

Reads the site address and AGENT_TOKEN from .secrets/site.json at the agency folder root:
  {"url": "https://<name>.<account>.workers.dev", "agent_token": "..."}

  agent.py beat ["what I'm doing"]
  agent.py inbox                          open comments and posts with changes requested
  agent.py client '{"name":..,"handle":..,"profile_url":..,"avatar":..,"bio":..}'
  agent.py clients
  agent.py post <client_id> "<title>" [--kind reel|story|short|long|post] [--caption "..."]
  agent.py upload <post_id> <video file> [--note "..."]     new version → appears in For You
                                          --note floats over the video in the app as a bubble from you. No note is the default.
                                          Never list routine work (captions, noise cleaned, silences cut): she does not want to read it.
                                          Only when she has to know: something to check (a name you are not sure of), something you did
                                          that she did not ask for (blurred a password on screen), something you could not do, a question.
                                          One short sentence
                                          (Bunny library if the site has one, otherwise the site's own R2 bucket)
  agent.py upload-images <post_id> <img> [<img> ...] [--note "..."]   new version made of still images (jpg/png, up to 20, in the order given):
                                          one image = an image post, several = a carousel (make the post with --kind post first). Shows up in For You
                                          like a reel (swipe between slides, comments point at a slide). Same --note rule as upload. Images only: no video slides
  agent.py approved [--all] [--kind story]   posts whose video is approved (not yet scheduled; --all = also scheduled/published)
  agent.py texts <post_id>                text captions Jennie placed on a story (JSON list), to bake into the video before posting.
                                          Also in `approved` output as the `texts` field of each post. Per text:
                                          text (Hebrew, RTL, may contain newlines), style (white-box = white rounded box + black text,
                                          black-box = black rounded box + white text, shadow = white text with a soft shadow),
                                          x, y = CENTRE of the box in percent of a 1080x1920 frame (50,50 = middle), width_pct = MAX box width (box shrink-wraps the text; padding included) in
                                          percent of the 1080 width, font_px_at_1080 = font size in px on the 1080 px wide frame,
                                          rotation in degrees. Font Heebo ExtraBold (800), centred, line-height 1.25; box padding .22em .5em, radius .4em
  agent.py trim <post_id>                 Instagram-style trim Jennie set on a story's current version: {trim_in, trim_out, duration} in seconds,
                                          null = not trimmed on that side. Also `trim_in`/`trim_out` in `approved`. bake_texts.py applies it
                                          (cuts video+audio, re-encodes), so always bake a story before posting, even with no stickers
  agent.py batch <client_id> "<title>" [--at ISO] [--kind story] <post_id> <post_id> ...   group a client's posts (e.g. one story series) into
                                          ONE card in the iPhone app, in the order given; the app sends one push per batch ("N stories waiting")
  agent.py batches                        every batch with its posts (id, position, stage, video_state)
  agent.py batch-edit <batch_id> [--title "..."] [--at ISO] [--posts 6,7,8]   rename, reschedule, or re-set the posts/order of a batch
  agent.py share-stories <post_id> <post_id> ...   public view-only link (/s/<token>) to those stories in that order, current versions, with her text stickers;
                                          no login, no approve/comment. Prints the URL
  agent.py revoke-share <token>           kills a share link
  agent.py download <post_id> [out.mp4]   the current version's file of a post
  agent.py mark-scheduled <post_id> [--at 2026-11-25T18:00:00+02:00]   stage → scheduled
  agent.py restore-post <post_id>        bring back a post Jennie deleted on the site
  agent.py backfill-lite [folder]         light copies (720 px, ~1.5 Mbps) for R2 videos that have none; the phone plays the light copy.
                                          New uploads get one automatically (needs ffmpeg). With a folder: originals named <post_id>.mp4 there are used
  agent.py backfill-posters               first-frame covers for R2 videos that have none (new uploads get one automatically)
  agent.py storage                        where videos go: {"bunny": bool, "r2": bool}
  agent.py caption <post_id> "<text>"
  agent.py cover-options <post_id> <img> [<img> …] [--note "..."]   cover options she picks from (make them with make_covers.py)
  agent.py cover <post_id> <image file>   |   agent.py cover-time <post_id> <seconds>
  agent.py done <comment_id> ["what I did"]
  agent.py secrets                        ElevenLabs key for transcription (kept in memory, never printed)

  Jobs: Jennie's "new job" sheet (the + on the site): files from her phone + text and/or voice notes.
  agent.py jobs [--all | --status new,working]   the queue (default: queued, new, working). queued = sent, files still uploading
  agent.py job <id>                       one job as JSON: text, files (role media|voice, name, size, state), voice transcripts.
                                          Voice notes without a transcript are transcribed now (site, else Scribe on this Mac)
  agent.py download-job <id> <dir>        every file of the job into <dir>, plus <dir>/job.json (text + transcripts)
  agent.py job-status <id> working|done|new [--note "..."] [--posts 6,7,8]   she sees status + note in her queue.
                                          Always pass --posts on done: her phone opens them, and the stories of one job reach her
                                          as one notification when the job is done. --note only when she has to know or answer
                                          something (same rule as upload --note); never a list of what was done
  agent.py set-bunny-key                 BUNNY_API_KEY (the Bunny account key) from this Mac: makes the site its own Bunny Stream
                                          library and saves its key, so uploads (long videos too) go to Bunny. Never printed
  agent.py set-elevenlabs-key             copy ELEVENLABS_API_KEY from this Mac (env / jennie-edit-kit / video-use .env) into
                                          the site's encrypted settings, so the site transcribes voice notes itself. Never printed
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
    put_poster(r["guid"], path)
    put_lite(r["guid"], path, dur)
    print(json.dumps(out, ensure_ascii=False))


def make_lite(src, dst):
    """A light copy for the phone: short side 720 px, about 1.5 Mbps, a keyframe every second, starts playing at once."""
    scale = "scale='if(gt(iw,ih),-2,min(720,iw))':'if(gt(iw,ih),min(720,ih),-2)'"
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", src, "-vf", scale, "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high",
           "-b:v", "1400k", "-maxrate", "1800k", "-bufsize", "2800k", "-g", "30", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "96k", "-ac", "2", "-movflags", "+faststart", dst]
    try:
        return subprocess.run(cmd).returncode == 0 and os.path.getsize(dst) > 0
    except (FileNotFoundError, OSError):
        return False


def put_lite(guid, video_path, duration=None):
    """Makes the light copy of an R2 video and stores it next to the original. The phone plays the light one,
    so a video opens at once on a slow connection; saving and publishing still use the original.
    Skipped (quietly) without ffmpeg, and for films over 10 minutes."""
    if duration and duration > 600:
        return False
    with tempfile.TemporaryDirectory() as d:
        lite = os.path.join(d, "lite.mp4")
        if not make_lite(video_path, lite):
            print("light copy: not made (ffmpeg missing or failed); the phone will use the original", file=sys.stderr)
            return False
        c = conf()
        try:
            r = put_file(c["url"].rstrip("/") + f"/api/agent/r2/lite/{guid}", lite,
                         {"authorization": "Bearer " + c["agent_token"], "content-type": "application/octet-stream"})
        except (Exception, SystemExit) as e:  # a site that has no light copies yet: the upload itself already went through
            print(f"light copy: the site did not take it ({str(e)[:120]}); the phone will use the original", file=sys.stderr)
            return False
        if r.get("ok"):
            print(f"light copy: {os.path.getsize(lite) // 1024} KB for {guid}", file=sys.stderr)
            return True
        print(f"light copy: upload failed {r}", file=sys.stderr)
        return False


def backfill_lite(local_dir=None):
    """Light copies for R2 videos that have none. With a folder, an original named <post_id>.mp4 or <guid>.mp4
    there is used instead of downloading it again (only for the post's current version)."""
    c = conf()
    todo = call("GET", "/r2/missing-lite").get("versions", [])
    done = 0
    with tempfile.TemporaryDirectory() as d:
        for v in todo:
            g = v["bunny_guid"]
            src = None
            if local_dir:
                for name in (f"{g}.mp4", f"{v['post_id']}.mp4" if v.get("current") else None):
                    if name and os.path.exists(os.path.join(local_dir, name)):
                        src = os.path.join(local_dir, name)
                        break
            try:
                if not src:
                    src = os.path.join(d, "orig.mp4")
                    fetch_to(c["url"].rstrip("/") + f"/api/agent/media/{g}.mp4", src)
                if put_lite(g, src, v.get("duration")):
                    done += 1
            except (Exception, SystemExit) as e:  # one bad file does not stop the rest
                print(f"light copy: {g} skipped ({e})", file=sys.stderr)
    return {"missing": len(todo), "made": done}


def image_size(path):
    """(width, height) of a JPEG or PNG, standard library only. Raises ValueError for anything else."""
    with open(path, "rb") as f:
        head = f.read(26)
        if head[:8] == b"\x89PNG\r\n\x1a\n":
            return int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big")
        if head[:2] == b"\xff\xd8":
            f.seek(2)
            while True:
                b = f.read(1)
                while b and b != b"\xff":
                    b = f.read(1)
                while b == b"\xff":
                    b = f.read(1)
                if not b:
                    break
                marker = b[0]
                if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                    continue
                seg = f.read(2)
                if len(seg) < 2:
                    break
                length = int.from_bytes(seg, "big")
                if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                    data = f.read(5)
                    return int.from_bytes(data[3:5], "big"), int.from_bytes(data[1:3], "big")
                f.seek(length - 2, 1)
    raise ValueError(f"not a readable jpg/png: {path}")


def upload_images(post_id, paths, note=None):
    """Image post / carousel: every picture goes into the site's R2 bucket, then they become ONE new version in the given order."""
    post_id = int(post_id)
    if not paths:
        sys.exit("upload-images <post_id> <img> [<img> ...]")
    if len(paths) > 20:
        sys.exit("at most 20 images in one post")
    for pth in paths:
        if not os.path.isfile(pth):
            sys.exit(f"no such file: {pth}")
        if not pth.lower().endswith((".jpg", ".jpeg", ".png")):
            sys.exit(f"only jpg or png (images only, no video slides): {pth}")
    if not call("GET", "/storage").get("r2"):
        sys.exit("the site has no R2 bucket: images are stored there")
    c = conf()
    slides = []
    for i, pth in enumerate(paths, 1):
        try:
            w, h = image_size(pth)
        except ValueError as e:
            sys.exit(str(e))
        print(f"uploading image {i}/{len(paths)} ({os.path.getsize(pth) // 1024} KB)…", file=sys.stderr)
        r = put_file(c["url"].rstrip("/") + "/api/agent/r2/image?name=" + urllib.parse.quote(os.path.basename(pth)), pth,
                     {"authorization": "Bearer " + c["agent_token"], "content-type": "application/octet-stream"})
        if not r.get("guid"):
            sys.exit(f"upload failed: {r}")
        slides.append({"guid": r["guid"], "ext": r["ext"], "width": w, "height": h, "bytes": r.get("size")})
    print(json.dumps(call("POST", f"/posts/{post_id}/image-versions", {"slides": slides, "note": note}), ensure_ascii=False))


def put_poster(guid, video_path):
    """R2 has no Bunny thumbnail: the first frame (at 0.1s) becomes the video's cover on the site."""
    with tempfile.TemporaryDirectory() as d:
        jpg = os.path.join(d, "poster.jpg")
        res = subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "0.1", "-i", video_path, "-frames:v", "1",
                              "-vf", "scale='min(720,iw)':-2", "-q:v", "4", jpg], capture_output=True, text=True, timeout=120)
        if res.returncode or not os.path.isfile(jpg):
            print(f"poster: ffmpeg failed for {guid}: {res.stderr[-300:]}", file=sys.stderr)
            return False
        with open(jpg, "rb") as f:
            call("PUT", f"/r2/poster/{guid}", raw=f.read(), ctype="image/jpeg")
    print(f"poster: first frame set for {guid}", file=sys.stderr)
    return True


def backfill_posters():
    """First-frame covers for R2 videos uploaded before posters existed."""
    c = conf()
    todo = call("GET", "/r2/missing-posters").get("versions", [])
    print(f"{len(todo)} R2 version(s) without a poster", file=sys.stderr)
    done = 0
    for v in todo:
        with tempfile.TemporaryDirectory() as d:
            mp4 = os.path.join(d, "v.mp4")
            try:
                fetch_to(c["url"].rstrip("/") + f"/api/agent/media/{v['bunny_guid']}.mp4", mp4)
            except Exception as e:
                print(f"post {v['post_id']} version {v['id']}: download failed ({e})", file=sys.stderr)
                continue
            if put_poster(v["bunny_guid"], mp4):
                done += 1
    return {"posters_added": done, "of": len(todo)}


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


KEY_FILES = [os.path.expanduser(p) for p in ("~/code/jennie-edit-kit/.env", "~/code/video-use/.env")]


def local_key(name="ELEVENLABS_API_KEY"):
    """Same lookup as jennie-edit-kit/scripts/_env.py. The value stays in memory."""
    if os.environ.get(name):
        return os.environ[name]
    for path in KEY_FILES:
        if not os.path.exists(path):
            continue
        for line in open(path):
            line = line.strip()
            if line.startswith(name + "="):
                v = line.split("=", 1)[1].strip().strip('"').strip("'")
                if v:
                    return v
    return None


def fetch_to(url, dest):
    c = conf()
    req = urllib.request.Request(url)
    req.add_header("user-agent", "agency-approvals-agent/1.0")
    if url.startswith(c["url"].rstrip("/") + "/api/agent/"):
        req.add_header("authorization", "Bearer " + c["agent_token"])
    with urllib.request.urlopen(req, timeout=1800) as r, open(dest, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    return dest


def scribe_local(path, key):
    """ElevenLabs Scribe v3 (Hebrew) on this Mac: the fallback when the site has no key."""
    boundary = "----agent" + os.urandom(8).hex()
    fields = {"model_id": "scribe_v3", "language_code": "he", "tag_audio_events": "false", "diarize": "false"}
    body = b""
    for k, v in fields.items():
        body += f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
    body += f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{os.path.basename(path)}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode()
    body += open(path, "rb").read() + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request("https://api.elevenlabs.io/v1/speech-to-text", data=body, method="POST")
    req.add_header("xi-api-key", key)
    req.add_header("content-type", "multipart/form-data; boundary=" + boundary)
    with urllib.request.urlopen(req, timeout=600) as r:
        return (json.loads(r.read()).get("text") or "").strip()


def fill_transcripts(job):
    """Voice notes without a transcript: ask the site; if it has no key, Scribe here and save it back."""
    for f in job.get("files", []):
        if f["role"] != "voice" or f["state"] != "ready" or f.get("transcript_state") == "done":
            continue
        c = conf()
        req = urllib.request.Request(c["url"].rstrip("/") + f"/api/agent/jobs/{job['id']}/files/{f['id']}/transcript",
                                     data=json.dumps({"transcribe": True}).encode(), method="POST")
        req.add_header("authorization", "Bearer " + c["agent_token"])
        req.add_header("user-agent", "agency-approvals-agent/1.0")
        req.add_header("content-type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=600) as r:
                f["transcript"] = json.loads(r.read()).get("transcript", "")
                f["transcript_state"] = "done"
                continue
        except urllib.error.HTTPError:
            pass
        key = local_key()
        if not key:
            print(f"voice note {f['id']}: no ElevenLabs key on the site or this Mac; not transcribed", file=sys.stderr)
            continue
        tmp = os.path.join(tempfile.mkdtemp(), os.path.basename(f.get("name") or "voice.m4a"))
        fetch_to(f["url"], tmp)
        try:
            f["transcript"] = scribe_local(tmp, key)
            f["transcript_state"] = "done"
            call("POST", f"/jobs/{job['id']}/files/{f['id']}/transcript", {"transcript": f["transcript"]})
        except urllib.error.HTTPError as e:
            print(f"voice note {f['id']}: Scribe error {e.code}", file=sys.stderr)
    return job


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
    elif cmd == "batch":
        at = opt(a, "--at")
        kind = opt(a, "--kind", "story")
        body = {"client_id": a[0], "title": a[1], "kind": kind, "post_ids": [int(x) for x in a[2:]]}
        if at:
            body["scheduled_at"] = at
        out = call("POST", "/batches", body)["batch"]
    elif cmd == "batches":
        out = call("GET", "/batches").get("batches", [])
    elif cmd == "batch-edit":
        body = {}
        for flag, key in (("--title", "title"), ("--at", "scheduled_at")):
            v = opt(a, flag)
            if v is not None:
                body[key] = v
        posts = opt(a, "--posts")
        if posts:
            body["post_ids"] = [int(x) for x in posts.split(",") if x.strip()]
        out = call("PATCH", f"/batches/{int(a[0])}", body)["batch"]
    elif cmd == "restore-post":
        out = call("POST", f"/posts/{int(a[0])}/restore")["post"]
        out = {k: out.get(k) for k in ("id", "title", "kind", "stage")}
    elif cmd == "backfill-posters":
        out = backfill_posters()
    elif cmd == "backfill-lite":
        out = backfill_lite(a[0] if a else None)
    elif cmd == "upload":
        note = opt(a, "--note")
        return upload(a[0], a[1], note)
    elif cmd == "upload-images":
        note = opt(a, "--note")
        return upload_images(a[0], a[1:], note)
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
    elif cmd == "trim":
        out = call("GET", f"/posts/{int(a[0])}/trim")
    elif cmd == "texts":
        out = call("GET", f"/posts/{int(a[0])}/texts").get("texts", [])
    elif cmd == "share-stories":
        r = call("POST", "/story-shares", {"post_ids": [int(x) for x in a]})
        print(r["url"])
        return
    elif cmd == "revoke-share":
        tok = a[0].rstrip("/").split("/")[-1]
        print(json.dumps(call("POST", f"/story-shares/{tok}/revoke", {})))
        return
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
    elif cmd == "jobs":
        st = "all" if "--all" in a else opt(a, "--status", "queued,new,working")
        jobs = call("GET", "/jobs?status=" + urllib.parse.quote(st)).get("jobs", [])
        out = [{"id": j["id"], "status": j["status"], "sent_at": j.get("sent_at"), "text": j.get("text"), "note": j.get("status_note"),
                "files": sum(1 for f in j["files"] if f["role"] == "media"),
                "voice": [f.get("transcript") or f"(voice note {f['id']}, not transcribed yet)" for f in j["files"] if f["role"] == "voice"],
                "uploading": sum(1 for f in j["files"] if f["state"] == "uploading")} for j in jobs]
    elif cmd == "job":
        out = fill_transcripts(call("GET", f"/jobs/{int(a[0])}")["job"])
    elif cmd == "download-job":
        job = fill_transcripts(call("GET", f"/jobs/{int(a[0])}")["job"])
        d = a[1] if len(a) > 1 else f"job-{job['id']}"
        os.makedirs(d, exist_ok=True)
        files = []
        for f in job["files"]:
            if f["state"] != "ready":
                print(f"skip file {f['id']} ({f['name']}): {f['state']}", file=sys.stderr)
                continue
            name = f"{f['id']}-{os.path.basename(f.get('name') or 'file')}"
            print(f"downloading {name} ({(f.get('size') or 0) // 1024 // 1024} MB)…", file=sys.stderr)
            fetch_to(f["url"], os.path.join(d, name))
            files.append({**{k: f.get(k) for k in ("id", "role", "name", "content_type", "size", "transcript")}, "file": os.path.abspath(os.path.join(d, name))})
        meta = {"id": job["id"], "status": job["status"], "sent_at": job.get("sent_at"), "text": job.get("text"), "files": files}
        json.dump(meta, open(os.path.join(d, "job.json"), "w"), ensure_ascii=False, indent=1)
        out = meta
    elif cmd == "job-status":
        note = opt(a, "--note")
        body = {"status": a[1]}
        if note is not None:
            body["note"] = note
        posts = opt(a, "--posts")
        if posts:
            body["posts"] = [int(x) for x in posts.split(",") if x.strip()]
        out = call("POST", f"/jobs/{int(a[0])}/status", body)["job"]
        out = {k: out.get(k) for k in ("id", "status", "status_note", "picked_at", "done_at", "posts")}
    elif cmd == "set-elevenlabs-key":
        k = local_key()
        if not k:
            sys.exit("ELEVENLABS_API_KEY not found on this Mac")
        call("POST", "/settings", {"elevenlabs_key": k})
        print("elevenlabs key: saved on the site (encrypted)")
        return
    elif cmd == "set-bunny-key":
        k = local_key("BUNNY_API_KEY")
        if not k:
            sys.exit("BUNNY_API_KEY not found on this Mac")
        r = call("POST", "/settings", {"bunny_account_key": k})
        print(f"bunny: new video library {r.get('library_id')} made for this site, key saved (encrypted). New videos go to Bunny")
        return
    elif cmd == "secrets":
        k = call("GET", "/secrets").get("elevenlabs_key")
        print("elevenlabs key: " + ("set" if k else "not set"))
        return
    else:
        sys.exit(__doc__)
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
