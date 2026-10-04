# Live (push) + Scorer tutorial

## Files to upload to GitHub `public/`

| File | Action |
|------|--------|
| `live.html` | Replace existing |
| `tutorial.html` | New file (animated scorer guide) |

## Live changes
- WebSocket score push (`connectScoreWs` → `/ws?match=...`)
- Polling only as 8s backup when tab visible
- Floats / chat intervals slightly slowed (free-tier safe)

## Tutorial
- Open `/tutorial.html`
- 8 animated steps: Settings → Teams → Match → Toss → Scoring → Live link → Stats/History
- Link from scorer using SCORER_TUTORIAL_LINK.txt
