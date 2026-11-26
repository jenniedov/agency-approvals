# The agency folder

This folder is the agency's whole system: client knowledge, edits, and the approval site (`site/`). Hebrew is the working language with the agency and its clients.

## Rules
- Never print keys or tokens in the chat. Keys live in `.secrets/` (gitignored) and, encrypted, in the site's database.
- Raw footage and renders stay in `media/` or `clients/<client>/edits/` and never go to git (see `.gitignore`).
- Nothing reaches a client without a human approval in the site. Claude prepares, people approve.
- Sending a message, publishing a post, or spending money needs the owner's explicit yes each time.

## Where things are
- `clients/<id>/CLAUDE.md`: who the client is, tone of voice, do and don't, links. Read it before any work for that client.
- `clients/<id>/edits/<yyyy-mm-dd>-<name>/`: one folder per edit (project file, exports, notes). `clients/<id>/log.md`: one line per thing done.
- `site/scripts/agent.py`: Claude's connection to the site (upload a version, read comments, mark them done, add a client). `python3 site/scripts/agent.py` lists the commands.
- `site/public/theme.css`: the look. Change design there first.

## Daily loop
1. `agent.py beat "<what you're doing>"` so the site shows the computer is on.
2. `agent.py inbox`: open comments (with the second they point at) and posts sent back for changes.
3. Fix each one in the edit, `agent.py upload <post> <file>`, then `agent.py done <comment>` (a note only by the rule below).
   Image post or carousel (`--kind post`): `agent.py upload-images <post> <img> [<img> ...]` (jpg/png, order = slide order; a corrected carousel is another `upload-images`). Comments on it come back with a `slide` number in `inbox`.
4. New edit for a client: `agent.py post <client> "<title>"`, then upload. It shows up in For You for approval.
5. Stories: `agent.py post <client> "<title>" --kind story`, then upload. They show as story rings at the top of For You (`/foryou?stories=<client>`), not in the reels feed.
6. Ready to post: `agent.py approved [--kind story]` lists approved videos, `agent.py download <post> [out.mp4]` fetches the file, `agent.py mark-scheduled <post> [--at ISO]` once it is scheduled.

## Notes to her: only when she has to know
A note (`--note` on `upload`, on `job-status`, the text of `done`) is the exception, not a report. The default is no note.
- Never list the routine work: captions added, noise cleaned, silences cut, no zooms. She sees that in the video and does not want to read it.
- Write a note only for one of these: something she should check (a name or word you are not sure you heard right), something you did that she did not ask for and could not expect (blurred a password that was on screen, cut a half sentence at the end, put the photo last), something you could not do, or a question to her.
- One short sentence, the thing itself first. "תבדקי את השם Carbyne בכתובית", not "כתוביות בעברית, ניקיתי רעש, בלי זומים. שם החברה כתוב Carbyne...".
- `job-status <id> done`: no note when the videos speak for themselves. `--posts` is what matters there: it is how her phone opens them and how the stories of one job reach her as one notification.

Skills: `/add-client` (from an Instagram or TikTok link), `/upload-edit`, `/prepare-covers` (3 cover options, she picks), `/handle-comments`.
