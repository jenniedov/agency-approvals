---
name: upload-edit
description: Put a finished edit into the approval site so the team sees it in For You. Use after rendering a video for a client, or when the owner says "upload it for approval", "תעלה לאישור".
---

1. Find or create the post: `agent.py post <client> "<title>" --kind reel|story|short|long|post --caption "<caption>"`. For a fix to an existing post use its id; a new upload becomes the next version.
2. Write the caption in the client's tone (read `clients/<client>/CLAUDE.md`). Offer 2 options in the caption field only when asked.
3. `agent.py upload <post> <file> --note "<what is new in this version>"`. It waits for Bunny to finish encoding.
4. Cover: if there is a designed cover image, `agent.py cover <post> <image>`; otherwise `agent.py cover-time <post> <second>` with the best frame.
5. Add one line to `clients/<client>/log.md`. Tell the owner it is waiting in For You.
