# Astral Cinema · Watch Party

A real-time watch-party website in a dark, cinematic style: a numbered hero carousel with a poster rail,
a movie page with cast and storyline, and a **cinema seat map** that doubles as the room you actually sit in.
Friends join with a code or link, everyone's video stays in sync, and chat shows up as speech bubbles above heads.

**Zero dependencies.** Plain Node.js (v22+), no `npm install`, no build step.

## Run it (Windows / VS Code)

1. Install Node.js 22 or newer (LTS) from https://nodejs.org
2. Open this folder in VS Code, then open a terminal (Ctrl + `) and run:

   ```
   node server.js
   ```
3. Open http://localhost:3000
4. To try it alone, open a second **private/incognito window** on the same address and join the same room.
   Pick **Signal: Test Reel**: it plays offline and shows a live timer, so you can see both windows are in sync.

Optional: `npm start` does the same, `npm run dev` restarts on file changes, `npm run loadtest` runs the latency test.

### Invite friends
* **Same Wi-Fi:** run `ipconfig`, find your IPv4 address and share `http://THAT-ADDRESS:3000` (allow Node through the Windows firewall when asked).
* **Over the internet, quickly:** use a tunnel, e.g. Cloudflare (`cloudflared tunnel --url http://localhost:3000`) or ngrok (`ngrok http 3000`), and share the URL it prints.
* **Permanently:** deploy to any host that runs a long-lived Node process with WebSockets (Render, Railway, Fly.io, a VPS). Start command `node server.js`; it reads the `PORT` environment variable.

## What's in it

| Area | What you get |
|---|---|
| **Discovery** | Hero carousel with auto-advance and a poster rail, movie pages, Browse with genre chips, sorting and **fuzzy search** (typos and skipped letters work), search overlay, a Live parties list |
| **Rooms** | Create from any movie, with a date/time slot and public or invite-only. Join by 5-letter code or invite link. Rooms hold many people: 72 seats, anyone beyond that stands at the back |
| **Synced playback** | Play, pause and seek are shared. Late joiners land on the right frame. Drift is corrected continuously (see below). Click-to-start overlay when the browser blocks autoplay |
| **Seat map** | Pick your seat, see everyone sitting. **Chat appears as speech bubbles over heads**, emoji reactions float up from the sender's seat |
| **Social** | Chat, reactions, a shared **queue with voting** (most votes plays next, auto-advances), **polls**, **host transfer**, optional "everyone can control" |
| **Resilience** | Reconnects automatically and keeps your seat for 25 s; if the host leaves the room passes to the next person; second tab takes over cleanly |
| **Playback sources** | Direct video links (mp4/webm) and **YouTube** links (paste into the queue or the "Choose a movie" box) |

## How sync works (short version)

The server is the source of truth. It stores `{playing, pos, at}`: the position at a server timestamp.
Each browser measures its clock offset to the server (ping/pong, keeps the lowest-RTT samples), so it can compute
*where the video should be right now*. Every 250 ms it compares that to the real player:

* off by more than 0.5 s → hard seek
* off by 60–500 ms → gently speed up or slow down (0.88x to 1.12x) until aligned
* the server also broadcasts a tick every 2 s so nobody can wander for long

The maths lives in `public/js/sync.js`, shared by the browser and the load test. YouTube cannot do fine speed changes, so it only hard-seeks.
Measurements are in [docs/LATENCY.md](docs/LATENCY.md).

## Project layout

```
server.js            HTTP + REST + WebSocket rooms (all the protocol handlers)
lib/ws.js            tiny RFC 6455 WebSocket server (why there are no dependencies)
lib/rooms.js         room state: playback, seats, queue, polls (pure logic)
data/movies.js       the catalogue, add your own here
scripts/loadtest.js  N bots + latency/drift report
public/
  index.html, css/styles.css
  js/main.js         router, header, menu, search, profile
  js/home.js         hero carousel          js/detail.js   movie page + seat picker
  js/browse.js       discovery + fuzzy      js/room.js     the room
  js/seatmap.js      seat map, bubbles      js/player.js   HTML5 + YouTube adapters
  js/sync.js         sync maths             js/net.js      websocket + clock sync
  js/art.js          generated posters/backdrops (no copyrighted images)
  media/demo.*       offline test clip
```

## Adding movies
Open `data/movies.js` and add an object. `source` is `{ kind: 'file', url: 'https://…/x.mp4' }` or `{ kind: 'youtube', ytId: 'VIDEOID' }`.
Posters and backdrops are generated from `theme: { h1, h2, motif }` (motifs: meadow, peaks, city, arches, rays, road, signal).
Only use video you have the right to stream. The bundled catalogue uses Blender Foundation open films (CC-BY) and Google's public sample clips.

## Honest limits
* **Netflix, Prime Video, Disney+ and similar cannot be synced** from a web page: they are DRM-protected and offer no embed or control API. Use YouTube, direct files, or have everyone press play on their own subscription while chatting here.
* Rooms live in server memory (a restart clears them) and there are no accounts. Identity is a name + colour saved in the browser.
* The 25-seat-per-row map is a UI limit, not a network one. The load test runs 50 clients in one room without trouble.
