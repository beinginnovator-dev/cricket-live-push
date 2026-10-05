# Short live viewer link

## Before
https://your.workers.dev/live.html?match=match-xxxx-yyyy&key=VIEWER_2026&server=https%3A%2F%2F...

## After
https://your.workers.dev/live.html?m=a3f9k2x1

## Files
- public/index.html (scorer – short match id + short URL)
- public/live.html (accepts m / k / s as well as match / key / server)

## Note
New matches get an 8-char id automatically.
Old long ids starting with `match-` are regenerated once when the scorer opens.
