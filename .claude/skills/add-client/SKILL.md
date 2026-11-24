---
name: add-client
description: Add a client to the agency site from their Instagram, TikTok or website link, so the site already knows their name, picture and bio. Use when the owner says "add client", "תוסיף לקוח", or pastes a profile link of a new client.
---

1. Open the link in the browser (the owner's Chrome if available; Instagram needs a signed-in session). Read the display name, handle, bio and profile picture URL. Do not log in or follow anyone.
2. Download the profile picture, shrink it to 160x160 JPEG (`sips -Z 160`), and make a `data:image/jpeg;base64,...` string. Instagram picture URLs expire, so never store the URL itself.
3. Pick a short id in English letters (`slug`), e.g. `cafe-noa`.
4. `python3 site/scripts/agent.py client '{"id":"<slug>","name":"<name>","handle":"<handle>","profile_url":"<link>","bio":"<bio>","avatar":"<data url>"}'`
5. Create `clients/<slug>/CLAUDE.md` with: who they are (from the bio and a look at their last 9 posts), tone of voice, recurring formats, colors, words they use. Create `clients/<slug>/style/` and `clients/<slug>/edits/`, and an empty `log.md`.
6. Tell the owner the client is in, and give the private approval link from the command's output (`share_url`). Do not send it to the client yourself.
