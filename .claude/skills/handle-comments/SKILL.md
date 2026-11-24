---
name: handle-comments
description: Go through comments and change requests from the approval site and fix them in the edits. Use when the owner says "check comments", "יש הערות", or at the start of a work session.
---

1. `agent.py beat "handling comments"` and `agent.py inbox`.
2. Group comments by post. Each has `at_sec` (the second in the video), `target` (video, caption, cover, music) and maybe a `drawing` (strokes in 0..1 coordinates over the frame).
3. Caption changes: `agent.py caption <post> "<new text>"`. Cover comments with `cover_option_id`: she wants that option with different text → make a new option from the same frame (`make_covers.py` with the new text, or edit that image) and `agent.py cover-options <post> <file> --note "<what changed>"`. See the prepare-covers skill.
4. Video changes: open the edit in `clients/<client>/edits/`, fix every comment for that post, render once, `agent.py upload <post> <file> --note "<list of what was fixed>"`.
5. `agent.py done <comment> "<what I did>"` for each one. If a comment is unclear, leave it open and tell the owner what to ask.
