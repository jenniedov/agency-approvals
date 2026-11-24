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
- `PATCH /api/posts/<id>` `{title?, caption?, music?, scheduled_at?, stage?}`
- `POST /api/posts/<id>/state` `{part: "video"|"caption"|"cover", state: "approved"|"changes"|"pending"}` → `{post}`. All three approved ⇒ stage `approved`. Any `changes` ⇒ stage back to `editing`.
- `POST /api/posts/<id>/comments` `{target, at_sec?, body, drawing?}` → `{comment}`
- `PATCH /api/comments/<id>` `{body?, at_sec?, drawing?, status?}` · `DELETE /api/comments/<id>`
- `POST /api/posts/<id>/share` `{client_id?}` → `{ok, url}`. Default = the post's own client; another client is allowed (the screen must confirm first). Marks `client_state=pending`, stage `client`.
- `POST /api/notifications/read` `{ids?: [..]}` (no ids = all)
- `GET /api/tracks` · `POST /api/tracks` `{title, artist?, source: "library"|"instagram", url?}`
- `GET /api/settings` → `{agency_name, bunny_library_id, bunny_cdn_host, has_bunny_key, has_elevenlabs_key}` · `POST /api/settings` (owner) same fields + keys

## End-client (no login)

- `GET /api/c/<token>` → `{brand, client, posts: [Post]}` (posts with `client_state=pending`, plus the last 10 approved)
- `POST /api/c/<token>/posts/<id>/approve` · `POST /api/c/<token>/posts/<id>/comment` `{body, at_sec?, target?}`

## Agent (bearer AGENT_TOKEN)

- `POST /api/agent/beat` `{machine, detail?}`
- `GET /api/agent/inbox` → `{comments: [Comment + post title + client], changes: [Post with any part = changes]}`
- `POST /api/agent/clients` upsert `{id?, name, handle?, profile_url?, avatar?, bio?, color?}` → `{client}`
- `POST /api/agent/posts` `{client_id, title, kind, orientation?, caption?}` → `{post}`
- `POST /api/agent/bunny/video` `{title, collection?}` → `{guid, library_id, upload_url, headers}` (the agent PUTs the file there)
- `GET /api/agent/bunny/video/<guid>` → Bunny status (`status` 4 = ready, `length`, `width`, `height`)
- `POST /api/agent/posts/<id>/versions` `{bunny_guid, duration?, width?, height?, note?}` → `{version}`; post goes to `review`, video/cover states reset to pending, event `new_video`
- `PATCH /api/agent/posts/<id>` `{caption?, title?, music?, cover_time?}` (`cover_time` seconds = Bunny takes the frame as the thumbnail)
- `POST /api/agent/posts/<id>/cover` body = image bytes (`content-type: image/jpeg|png`) → Bunny thumbnail, `cover_url` updated, cover_state pending
- `POST /api/agent/comments/<id>/done` `{note?}`
- `GET /api/agent/secrets` → `{elevenlabs_key}` (for transcription on the Mac)

## Shapes

```
Client  {id, name, handle, profile_url, avatar, bio, color, share_url, manager_id}
Post    {id, client_id, client_name, title, kind, orientation, stage,
         video_state, caption, caption_state, cover_url, cover_state,
         music, scheduled_at, client_state, created_at, updated_at,
         version: {id, n, bunny_guid, duration, width, height, note,
                   mp4: [url 720, url 480, url 360], hls, thumb, embed} | null,
         versions: [{id, n, created_at, note}],
         comments: [Comment]}
Comment {id, post_id, version_id, target, at_sec, body, drawing, author, author_kind, status, created_at, updated_at}
Event   {id, kind, post_id, client_id, actor, body, created_at, read_at}
```
`kind` of events: `new_video`, `new_version`, `client_approved`, `client_comment`, `comment`, `shared`, `approved`.
