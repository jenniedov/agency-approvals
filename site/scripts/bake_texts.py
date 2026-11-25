#!/usr/bin/env python3
"""Burn the client's IG-style text stickers (from the stories view) into a video before posting,
and apply the trim she set there (start/end), so what gets posted is what she approved.

usage: bake_texts.py <post_id> <in.mp4> <out.mp4>
Reads the stickers with `agent.py texts <post_id>` and the trim with `agent.py trim <post_id>`,
draws the stickers with the same CSS as stories.css (.st-text / .s-white-box / .s-black-box / .s-shadow)
in headless Chrome to a transparent 1080x1920 PNG, then overlays it with ffmpeg. The trim is cut
frame-accurately (output seeking, video and audio re-encoded). No stickers and no trim -> copies the file unchanged.
"""
import html, json, os, shutil, subprocess, sys, tempfile

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
COLOR = {"white-box": "#000", "black-box": "#fff", "shadow": "#fff"}
STYLES = {"white-box": "background:#fff;color:#000;", "black-box": "background:#000;color:#fff;",
          "shadow": "background:none;color:#fff;text-shadow:0 .04em .16em rgba(0,0,0,.7);"}

def page(texts):
    items = "".join(
        f'<div class="t" style="left:{t["x"]}%;top:{t["y"]}%;font-size:{t["font_px_at_1080"]}px;transform:translate(-50%,-50%) rotate({t.get("rotation") or 0}deg);'
        f'max-width:{t.get("width_pct") or 80}%;color:{COLOR.get(t.get("style"), "#000")}"><span style="{STYLES.get(t.get("style"), STYLES["white-box"])}">{html.escape(t["text"])}</span></div>'
        for t in texts)
    return f"""<!doctype html><meta charset=utf-8>
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@800&display=block" rel="stylesheet">
<style>html,body{{margin:0;width:1080px;height:1920px;background:transparent;overflow:hidden}}
.t{{position:absolute;transform:translate(-50%,-50%);box-sizing:border-box;width:max-content;
font-family:Heebo,sans-serif;font-weight:800;line-height:1.4;text-align:center;white-space:pre-line;overflow-wrap:anywhere;direction:rtl}}
.t>span{{padding:0 .42em;border-radius:.3em;-webkit-box-decoration-break:clone;box-decoration-break:clone}}</style>
<body>{items}</body>"""

def video_size(src):
    """Displayed width/height (after the phone's rotation flag, which ffmpeg applies)."""
    st = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                              "stream=width,height:stream_side_data=rotation", "-of", "json", src]))["streams"][0]
    w, h = st["width"], st["height"]
    rot = next((abs(int(d.get("rotation", 0))) for d in st.get("side_data_list", []) if "rotation" in d), 0)
    return (h, w) if rot % 180 == 90 else (w, h)

def sticker_box(w, h):
    """Where the stories view's 9:16 frame sits on the video: the video fills it with object-fit: cover,
    so a wider video is cropped left/right and a taller one top/bottom. Returns (bw, bh, x, y) in video pixels."""
    if w * 16 > h * 9:
        bw, bh = round(h * 9 / 16), h
    else:
        bw, bh = w, round(w * 16 / 9)
    return bw, bh, (w - bw) // 2, (h - bh) // 2

def main():
    post, src, out = sys.argv[1], sys.argv[2], sys.argv[3]
    here = os.path.dirname(os.path.abspath(__file__))
    agent = lambda *x: json.loads(subprocess.check_output([sys.executable, os.path.join(here, "agent.py"), *x]))
    texts = agent("texts", post)
    tr = agent("trim", post)
    cut = []  # output seeking after -i: exact to the frame because we re-encode
    if tr.get("trim_in"): cut += ["-ss", f'{tr["trim_in"]:.3f}']
    if tr.get("trim_out") is not None and not (tr.get("duration") and tr["trim_out"] >= tr["duration"] - 0.05): cut += ["-to", f'{tr["trim_out"]:.3f}']
    enc = ["-c:v", "libx264", "-crf", "17", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
    aud = ["-c:a", "aac", "-b:a", "192k"] if cut else ["-c:a", "copy"]
    if not texts:
        if not cut:
            shutil.copyfile(src, out); print("no stickers, no trim, copied"); return
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", src, *cut, *enc, *aud, out], check=True)
        print(f"trimmed {tr.get('trim_in') or 0}-{tr.get('trim_out')} -> {out}"); return
    d = tempfile.mkdtemp()
    open(f"{d}/s.html", "w").write(page(texts))
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
                    "--default-background-color=00000000", "--window-size=1080,1920", "--virtual-time-budget=4000",
                    f"--screenshot={d}/s.png", f"file://{d}/s.html"], check=True, capture_output=True)
    # the 1080x1920 layer is the stories view's 9:16 frame: scale it to that frame on the video (explicit sizes:
    # scale2ref's main_w changed meaning in ffmpeg 8 and left the layer unscaled, off-centre on a 720p video)
    bw, bh, bx, by = sticker_box(*video_size(src))
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", src, "-i", f"{d}/s.png", "-filter_complex",
                    f"[1:v]scale={bw}:{bh}:flags=lanczos,format=rgba[s];[0:v][s]overlay={bx}:{by}:format=auto",
                    *cut, *enc, *aud, out], check=True)
    print(f"baked {len(texts)} sticker(s)" + (f", trimmed {tr.get('trim_in') or 0}-{tr.get('trim_out')}" if cut else "") + f" -> {out}")

if __name__ == "__main__":
    main()
