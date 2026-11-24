# Agency approvals

A video approval system for social and marketing agencies and video editors. Each agency installs its own copy: its own Cloudflare (Worker + D1, free plan), its own Bunny Stream library, its own keys. Claude Code on the agency's computer edits, uploads and answers comments; people approve on the phone in a For You style feed; clients approve through a private link.

- Install: [INSTALL.md](INSTALL.md)
- How it fits together: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), API: [docs/API.md](docs/API.md)
- Look and feel: every color, radius and font is in `site/public/theme.css`
- Local dev: `cd site && ./scripts/seed_local.sh && npx wrangler dev`

Folder layout (the agency folder is the repo):

```
CLAUDE.md                 how Claude works in this agency
.claude/skills/           add-client, upload-edit, handle-comments
clients/<client>/         CLAUDE.md (who they are, tone), style/, edits/<date>-<name>/, log.md
site/                     the Worker, screens, migrations, scripts (agent.py, install.sh)
media/  .secrets/         stay on the computer, never in git
```
