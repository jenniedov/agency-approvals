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
3. Fix each one in the edit, `agent.py upload <post> <file> --note "<what changed>"`, then `agent.py done <comment> "<what I did>"`.
4. New edit for a client: `agent.py post <client> "<title>"`, then upload. It shows up in For You for approval.

Skills: `/add-client` (from an Instagram or TikTok link), `/upload-edit`, `/handle-comments`.
