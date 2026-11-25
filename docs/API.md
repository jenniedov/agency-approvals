# API contract

All JSON. Team routes need the session cookie (set by `/api/login` or `/api/setup`). Errors: `{error: "<code>"}` with a 4xx status.

## Session and setup

- `GET /api/session` → `{brand: {name}, setup_needed: bool, user: {id,name,email,role} | null}`
- `POST /api/setup` `{agency_name, name, email, password, bunny_account_key?, bunny_library_id?, bunny_library_key?, bunny_cdn_host?, elevenlabs_key?}` → `{ok, user}`. Only works while there are no users.
- `POST /api/login` `{email, password}` → `{ok, user}` · `POST /api/logout`

## Team

- `GET /api/overview` → `{brand, user, clients: [Client + counts {review, client, approved, changes}], notifications: [Event], unread: n, machine: {name, last_seen} | null, week: [Post with scheduled_at in next 7 days]}`
- `GET /api/clients` → `{clients: [Client]}` · `POST /api/clients` `{name, handle?, profile_url?, avatar?, bio?, color?}` · `PATCH /api/clients/<id>`
- `GET /api/feed?stage=review&client=<id>` → `{groups: [{client: Client, posts: [Post]}]}`. Groups keep client order, posts newest first inside a group. Default stage = review.
- `GET /api/posts?client=<id>` → `{posts: [Post]}` (all stages, for the board) · `GET /api/posts/<id>` → `{post: Post}`
- `PATCH /api/posts/<id>` `{title?, caption?, music?, scheduled_at?, stage?}` · `DELETE /api/posts/<id>` (owner) soft delete: `deleted_at` set, the post disappears from every list, feed, share and count; `agent.py restore-post <id>` brings it back
- `POST /api/posts/<id>/cover/choose` `{option_id}` → `{post}`; that option becomes `cover_url`, `cover_state` approved, and (real videos with a Bunny key) the Bunny thumbnail
- `POST /api/posts/<id>/comments` also takes `cover_option_id` with `target: "cover"` = "change the text on this option"; sets `cover_state` to changes
- `POST /api/posts/<id>/state` `{part: "video"|"caption"|"cover", state: "approved"|"changes"|"pending"}` → `{post}`. All three approved ⇒ stage `approved` (a `kind: "story"` post is approved by its video alone). Any `changes` ⇒ stage back to `editing`.
- `POST /api/posts/<id>/trim` `{in, out}` (seconds, rounded to 0.1, at least 1 s apart) or `{reset: true}` → `{version_id, trim_in, trim_out}`. Trims a story without touching the file: stored on the current version (`versions.trim_in` / `trim_out`, null = from the start / to the end), so a new version starts untrimmed. The stories view, the client screen and `/s/<token>` play only that part; event `trimmed`. Errors `too_short`, `bad_trim`
- `POST /api/posts/<id>/comments` `{target, at_sec?, body, drawing?}` → `{comment}`
- `PATCH /api/comments/<id>` `{body?, at_sec?, drawing?, status?}` · `DELETE /api/comments/<id>`
- `POST /api/posts/<id>/share` `{client_id?}` → `{ok, url}`. Default = the post's own client; another client is allowed (the screen must confirm first). Marks `client_state=pending`, stage `client`.
- `POST /api/notifications/read` `{ids?: [..]}` (no ids = all)
- `GET /api/tracks` · `POST /api/tracks` `{title, artist?, source: "library"|"instagram", url?}`
- `GET /api/settings` → `{agency_name, bunny_library_id, bunny_cdn_host, has_bunny_key, has_elevenlabs_key}` · `POST /api/settings` (owner) same fields + keys

- `GET /media/r2-<id>.mp4` streams an R2-hosted video (HTTP Range, 206). Needs the session cookie or `?t=<share token>` of the client that owns the post; anything else is 403. Playback URLs of R2 videos point here (with `?t=` on the client screens)
- `GET /media/r2-<id>.jpg` the first frame of that video (same access). `version.thumb` points here once the Mac uploaded it (`versions.poster = 1`); without it the screens show the video itself at 0.1s

## Jobs (owner only: "+" button, files from the phone + text / voice note for Claude)

- `POST /api/jobs` → `{job, part_size}` creates a draft. `GET /api/jobs` the last 30 sent jobs with files. `GET /api/jobs/<id>`. `DELETE /api/jobs/<id>` (any status: the job and its uploaded files; posts it produced stay). A job has `posts: [{id, kind, client_id, title, video_state}]` (what it produced, deleted ones left out); the card links to the first one
- `POST /api/jobs/<id>/files` `{name, size, content_type, role: media|voice}` → `{file_id, part_size, parts}` starts an R2 multipart upload (≤8 GB)
- `PUT /api/jobs/<id>/files/<fid>/parts/<n>` body = octet-stream, exactly `part_size` (10 MiB) except the last → `{etag}`. `POST …/files/<fid>/complete` `{parts: [{part_number, etag}]}`
- `POST …/files/<fid>/transcribe` (voice: ElevenLabs Scribe, Hebrew; 409 `no_key` without the site key). `DELETE …/files/<fid>` (draft only). `GET …/files/<fid>/media` (Range)
- `POST /api/jobs/<id>/send` `{text, force?}` → status `queued` while files upload, `new` once all are ready. Then `working` / `done` (set by the agent)

## Screens

- `/foryou` reels feed. Posts with `kind: "story"` never appear in the feed; they show as story rings at the top
- `/foryou?stories=<client id>` opens that client's stories straight away (`?stories=1` = all clients; `?post=<story id>` opens at that story)

## End-client (no login)

- `GET /api/c/<token>` → `{brand, client, posts: [Post]}` (posts with `client_state=pending`, plus the last 10 approved)
- `POST /api/c/<token>/posts/<id>/approve` · `POST /api/c/<token>/posts/<id>/comment` `{body, at_sec?, target?}`

## Agent (bearer AGENT_TOKEN)

- `POST /api/agent/beat` `{machine, detail?}`
- `GET /api/agent/inbox` → `{comments: [Comment + post title + client], changes: [Post with any part = changes]}`
- `POST /api/agent/clients` upsert `{id?, name, handle?, profile_url?, avatar?, bio?, color?}` → `{client}`
- `POST /api/agent/posts` `{client_id, title, kind, orientation?, caption?}` → `{post}`
- `POST /api/agent/bunny/video` `{title, collection?}` → `{guid, library_id, upload_url, headers}` (the agent PUTs the file there)
- `GET /api/agent/storage` → `{bunny: bool, r2: bool}` (where an upload will go)
- `PUT /api/agent/r2/upload?name=<file>` body = the MP4 bytes (content-length required, ≤100 MB) → `{guid: "r2-…", size}`. Only when the Worker has the optional `MEDIA` R2 binding; then register it with `POST /api/agent/posts/<id>/versions {bunny_guid: guid}`
- `GET /api/agent/media/r2-<id>.mp4` the same file for the agent (bearer auth, Range supported)
- `GET /api/agent/approved?kind=story&all=1` → `{posts: [{id, title, kind, client_id, client_name, stage, scheduled_at, caption, updated_at, version_n, bunny_guid, duration, width, height, download_url}]}`. Video approved and not yet scheduled/published (`all=1` includes those). `download_url` = the agent media route for R2, the Bunny MP4 otherwise. Each post also carries `trim_in`, `trim_out`
- `GET /api/agent/posts/<id>/trim` → `{post_id, version_id, trim_in, trim_out, duration}` (`agent.py trim <id>`). `scripts/bake_texts.py <id> in.mp4 out.mp4` burns the stickers and cuts the trim (frame-accurate, re-encoded); run it on every story before posting
- `POST /api/agent/posts/<id>/scheduled` `{at?: ISO}` → `{post}`; stage `scheduled`, `scheduled_at` set when given, event `scheduled`
- `GET /api/agent/bunny/video/<guid>` → Bunny status (`status` 4 = ready, `length`, `width`, `height`)
- `POST /api/agent/posts/<id>/versions` `{bunny_guid, duration?, width?, height?, note?}` → `{version}`; post goes to `review`, video/cover states reset to pending, event `new_video`
- `PATCH /api/agent/posts/<id>` `{caption?, title?, music?, cover_time?}` (`cover_time` seconds = Bunny takes the frame as the thumbnail)
- `POST /api/agent/posts/<id>/cover-options` `{image: "data:image/jpeg;base64,…" (≤1.5 MB), note?, notify?}` → `{option: {id, url, note}}`; cover_state back to pending, event `new_cover` unless `notify: false`
- `GET /cover/<token>.jpg` (public, unguessable) serves an option's image
- `POST /api/agent/posts/<id>/cover` body = image bytes (`content-type: image/jpeg|png`) → Bunny thumbnail, `cover_url` updated, cover_state pending
- `POST /api/agent/comments/<id>/done` `{note?}`
- `GET /api/agent/secrets` → `{elevenlabs_key}` (for transcription on the Mac)
- `GET /api/agent/jobs?status=queued,new,working|all` → `{jobs}` · `GET /api/agent/jobs/<id>` → `{job}` with file URLs · `GET /api/agent/jobs/<id>/files/<fid>` the file (ready only)
- `POST /api/agent/jobs/<id>/files/<fid>/transcript` `{transcribe: true}` (on the site) or `{transcript}` (from the Mac)
- `POST /api/agent/jobs/<id>/status` `{status: new|working|done, note?, posts?: [post ids]}`; events `job_working` / `job_done` ring her bell. `posts` = what the job produced: her queue card opens them for approval
- `PUT /api/agent/r2/poster/<guid>` body = JPEG (≤3 MB) → first frame of an R2 video, sets `versions.poster`. `GET /api/agent/r2/missing-posters` → `{versions: [{id, post_id, bunny_guid}]}`
- `POST /api/agent/posts/<id>/restore` undoes a delete
- `POST /api/agent/settings` `{bunny_library_id?, bunny_library_key?, bunny_cdn_host?, elevenlabs_key?, agency_name?}`, or `{bunny_account_key}` = make this site its own Bunny Stream library (409 `bunny_already_set` unless `replace: true`). CLI: `agent.py set-bunny-key` (reads BUNNY_API_KEY on the Mac)
- CLI: `agent.py jobs | job <id> | download-job <id> <dir> | job-status <id> <status> --note "…" --posts 6,7 | restore-post <id> | backfill-posters | set-elevenlabs-key`. `upload` of an R2 video also uploads its first frame

## Shapes

```
Client  {id, name, handle, profile_url, avatar, bio, color, share_url, manager_id}
Post    {id, client_id, client_name, title, kind, orientation, stage,
         video_state, caption, caption_state, cover_url, cover_state,
         cover_options: [{id, url, note, chosen}],
         music, scheduled_at, client_state, created_at, updated_at,
         version: {id, n, bunny_guid, duration, width, height, note,
                   mp4: [url 720, url 480, url 360], hls, thumb, embed} | null,
         versions: [{id, n, created_at, note}],
         comments: [Comment]}
Comment {id, post_id, version_id, target, at_sec, body, drawing, author, author_kind, status, created_at, updated_at}
Event   {id, kind, post_id, client_id, actor, body, created_at, read_at}
```
`kind` of events: `new_video`, `new_version`, `client_approved`, `client_comment`, `comment`, `shared`, `approved`, `scheduled`.

`version.bunny_guid` prefixes: `demo-…` = bundled demo file, `r2-…` = stored in the Worker's R2 bucket (no Bunny thumbnail; cover routes answer `bunny_only`), anything else = Bunny Stream.
