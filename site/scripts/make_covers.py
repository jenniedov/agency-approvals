#!/usr/bin/env python3
"""Prepare cover options from a video: a few frames, each with the title in a different style.

  make_covers.py <video> "<title>" [--out DIR] [--times 1.5,4,7] [--prefix cover]

Writes DIR/<prefix>-1.jpg … (1080 wide, same shape as the video, JPEG ~150 KB) and prints the paths.
Styles in order: big title on a dark fade at the bottom, white box in the middle, clean frame (no text).
Then:  agent.py cover-options <post_id> DIR/<prefix>-*.jpg --note "..."
Needs ffmpeg and Pillow (python3 -m pip install pillow).
"""
import os, re, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONTS = [("/System/Library/Fonts/ArialHB.ttc", 1), ("/System/Library/Fonts/SFHebrew.ttf", 0), ("/System/Library/Fonts/Supplemental/Arial Unicode.ttf", 0),
         ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 0)]


def font(size):
    for f, idx in FONTS:
        if os.path.exists(f):
            try:
                return ImageFont.truetype(f, size, index=idx, layout_engine=ImageFont.Layout.BASIC)
            except Exception:
                pass
    return ImageFont.load_default()


def visual(line):
    """Pillow without libraqm draws left-to-right: put Hebrew runs in visual order, keep numbers/Latin as is."""
    if not re.search(r"[֐-׿]", line):
        return line
    ltr = r"[A-Za-z0-9](?:[A-Za-z0-9.,:/%@#_-]*[A-Za-z0-9%])?"
    runs = re.findall(ltr + r"|(?:(?!" + ltr + r").)+", line)
    out = []
    for r in reversed(runs):
        out.append(r if re.fullmatch(ltr, r) else r[::-1].translate(str.maketrans("()[]", ")(][")))
    return "".join(out)


def wrap(draw, text, f, width):
    lines, cur = [], ""
    for w in text.split():
        t = (cur + " " + w).strip()
        if draw.textlength(visual(t), font=f) <= width or not cur:
            cur = t
        else:
            lines.append(cur); cur = w
    return lines + ([cur] if cur else [])


def frame(video, t, path):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(t), "-i", video, "-frames:v", "1", "-q:v", "2", path], check=True)
    im = Image.open(path).convert("RGB")
    return im.resize((1080, round(im.height * 1080 / im.width)), Image.LANCZOS)


def style_bottom(im, title):
    W, H = im.size
    fade = Image.new("L", (1, H))
    for y in range(H):
        fade.putpixel((0, y), int(200 * max(0, (y - H * 0.45) / (H * 0.55)) ** 1.4))
    dark = Image.new("RGB", (W, H), (0, 0, 0))
    im = Image.composite(dark, im, fade.resize((W, H)))
    d = ImageDraw.Draw(im)
    f = font(int(W * 0.095))
    lines = wrap(d, title, f, W * 0.84)
    lh = int(f.size * 1.18)
    y = H - int(H * 0.09) - lh * len(lines)
    for ln in lines:
        v = visual(ln)
        d.text(((W - d.textlength(v, font=f)) / 2, y), v, font=f, fill="white")
        y += lh
    return im


def style_box(im, title):
    W, H = im.size
    d = ImageDraw.Draw(im)
    f = font(int(W * 0.07))
    lines = wrap(d, title, f, W * 0.72)
    lh = int(f.size * 1.25)
    bw = max(d.textlength(visual(l), font=f) for l in lines) + W * 0.1
    bh = lh * len(lines) + f.size * 0.7
    x0, y0 = (W - bw) / 2, H * 0.5 - bh / 2
    d.rounded_rectangle([x0, y0, x0 + bw, y0 + bh], radius=int(f.size * 0.45), fill="white")
    y = y0 + f.size * 0.3
    for ln in lines:
        v = visual(ln)
        d.text(((W - d.textlength(v, font=f)) / 2, y), v, font=f, fill=(17, 17, 17))
        y += lh
    return im


def main(a):
    if len(a) < 2:
        sys.exit(__doc__)
    video, title = a[0], a[1]
    def opt(n, dflt):
        return a[a.index(n) + 1] if n in a else dflt
    out = opt("--out", "covers"); prefix = opt("--prefix", "cover")
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video],
                               capture_output=True, text=True).stdout.strip() or 6)
    times = [float(x) for x in opt("--times", f"{dur*0.2:.2f},{dur*0.5:.2f},{dur*0.8:.2f}").split(",")]
    os.makedirs(out, exist_ok=True)
    styles = [style_bottom, style_box, lambda im, t: im]
    with tempfile.TemporaryDirectory() as tmp:
        for i, t in enumerate(times):
            im = styles[i % 3](frame(video, t, os.path.join(tmp, f"{i}.jpg")), title)
            p = os.path.join(out, f"{prefix}-{i + 1}.jpg")
            im.save(p, "JPEG", quality=82, optimize=True, progressive=True)
            print(p)


if __name__ == "__main__":
    main(sys.argv[1:])
