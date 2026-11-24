# Architecture

An approvals system an agency installs on its own accounts. Every install is single-tenant: one agency, its own Cloudflare account, its own Bunny library, its own GitHub repo. Nothing is shared with the author.

## The pieces

| Piece | What it is | Who owns it |
|---|---|---|
| `site/` | One Cloudflare Worker (API + static screens) and one D1 database | the agency's Cloudflare account |
| Video | Bunny Stream library (encoding, MP4 + HLS playback, video thumbnail = the cover) | the agency's Bunny account |
| The folder | This repo: `CLAUDE.md`, `.claude/skills/`, `clients/<client>/` (style, edits, log) | the agency's Mac + private GitHub |
| Claude | Claude Code on the agency's Mac. It edits, uploads, writes captions, answers comments through the agent API | the agency's Claude subscription |
| Transcripts | ElevenLabs, called by Claude on the Mac (key stored in settings, fetched by the agent) | the agency's ElevenLabs account |

No R2, no Workers AI, no paid Cloudflare feature: the install must work on a free account without a card. The one optional exception: an install without Bunny can bind an R2 bucket as `MEDIA` (see the comment in `site/wrangler.jsonc`); videos then upload to R2 (`bunny_guid` starts with `r2-`) and the Worker streams them at `/media/<guid>.mp4` with Range, to logged-in users and to the owning client's share token only.

## Data model (one D1, `site/migrations/0001_init.sql`)

- `settings(key, value)`: agency name, Bunny library id, CDN host. Secrets (Bunny library key, ElevenLabs key) are stored AES-GCM encrypted with the Worker secret `SECRETS_KEY`.
- `users(id, email, name, role, pass_hash)`: role is `owner`, `editor` or `manager` (account manager). Today one owner is created at setup; the table and roles are there so employees can be added without a schema change.
- `clients(id, name, handle, profile_url, avatar, bio, color, share_token, manager_id)`: one row per end-client. `share_token` is the unguessable link the end-client opens. `manager_id` is the account manager.
- `posts(id, client_id, title, kind, orientation, stage, video_state, caption, caption_state, cover_url, cover_state, music, scheduled_at, client_state, current_version_id)`
  - `kind`: reel, story, short, long, post. `orientation`: vertical or horizontal (horizontal opens the YouTube-style view).
  - `stage` (the board columns): `editing` → `review` (waits for the team) → `client` (sent to the end-client) → `approved` (ready to upload) → `scheduled` → `published`.
  - Three separate approvals: `video_state`, `caption_state`, `cover_state`, each `pending | approved | changes`. When all three are approved the post moves to `approved` by itself.
- `versions(id, post_id, n, bunny_guid, duration, width, height, note)`: every upload is a new version; comments point at a version.
- `comments(id, post_id, version_id, target, at_sec, body, drawing, author, author_kind, status)`: `target` is video, caption, cover, music or general. `at_sec` is the second in the video. `drawing` is JSON (normalised strokes drawn on the frame). `status` open → done (Claude marks done).
- `events(id, kind, post_id, client_id, actor, body, read_at)`: notifications and history in one table.
- `tracks(id, title, artist, source, url)`: the agency's own music list (the "safe songs" folder). Instagram's library cannot be read by an API; a track with `source='instagram'` is a name the person picks in the app at upload time.
- `machines(name, last_seen, detail)`: heartbeat from the Mac, so the screen can say "the computer is connected".

## Who can call what

| Caller | How it proves itself | Routes |
|---|---|---|
| Team member | email + password, signed cookie (HMAC with `SECRETS_KEY`) | `/api/*` |
| End-client | the unguessable `share_token` in the link, no login | `/api/c/<token>/*` and the page `/c/<token>` |
| Claude on the Mac | bearer `AGENT_TOKEN` (Worker secret, copy in `.secrets/agent.json`) | `/api/agent/*` |

First visit with no users goes to `/setup` (the onboarding): agency name, owner account, Bunny account API key (the Worker creates the library and keeps only the library key) and an optional ElevenLabs key. Keys entered later go through the settings screen.

## Why keys live in D1 and not in Worker secrets

A Worker cannot set its own secrets without a Cloudflare API token, and asking a non-technical owner for one is the hardest step there is. So the installer sets exactly two secrets once (`SECRETS_KEY`, `AGENT_TOKEN`, both random), and every key the owner pastes in the UI is encrypted with `SECRETS_KEY` before it is written to D1. GitHub Actions secrets are not needed: deploy runs from the Mac with `wrangler deploy` (a GitHub Action can be added later).

## Flow of one video

1. Claude edits on the Mac inside `clients/<client>/edits/<date>-<name>/`.
2. `site/scripts/agent.py upload` creates the Bunny video, uploads the file, waits for encoding, registers a version → post stage `review`, event `new_video` (notification for the team).
3. The manager opens the For You screen: approves or rejects the video, comments by second (typed or dictated, with a drawing), approves or edits the caption, approves the cover, picks music, shares to the end-client.
4. `agent.py inbox` gives Claude every open comment; Claude fixes, uploads a new version, marks comments done.
5. End-client approves on `/c/<token>` → stage `approved` → the scheduler (Postiz / Metricool) takes it.

## Not built yet (known)

- Team management screen (table and roles exist; only the owner is created).
- A comment waking Claude by itself (today Claude reads the inbox when a session runs).
- Sending a share to a client by WhatsApp or email (the share button records it and copies the link).
- Checking that a post really went out.
