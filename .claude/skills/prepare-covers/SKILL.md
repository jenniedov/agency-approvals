---
name: prepare-covers
description: Prepare 3 cover options for a post so the owner picks one on the site, and redo a cover when she asks for a text change. Use after uploading a new edit, or when the owner says "תכין קאברים", "covers", or leaves a comment on a cover.
---

The cover is her choice, not Claude's. Claude prepares options; she picks one in For You (or asks for a text change on one).

1. Find the post and its video file (`clients/<client>/edits/`). Read `clients/<client>/style` for the client's fonts, colors and how their covers usually look.
2. Pick the title: a short hook from the caption or the edit (2–5 words). Ask the owner only if the post has no caption and no obvious hook.
3. Make 3 options from different frames (a face, the product, the moment of the hook):
   `python3 site/scripts/make_covers.py <video> "<title>" --out /tmp/covers-<post> --times 1.2,4,7.5`
   Styles in order: big title on a dark fade, title in a white box, clean frame. If the client has their own look, edit the images yourself (Pillow) instead of using the defaults; keep the title inside the middle 4:5 area (the grid crops 9:16 to 4:5 on the profile).
4. Look at the three images before sending. Hebrew must read right to left, numbers in the right place.
5. `python3 site/scripts/agent.py cover-options <post> /tmp/covers-<post>/cover-*.jpg --note "<one line: which frame, which style>"`
6. Text change request (a cover comment with `cover_option_id`): take that option's frame, apply exactly the text she asked for, send it as a new option with `--note "לפי ההערה: …"`, then `agent.py done <comment>`.

Never pick for her and never call /cover/choose yourself.
