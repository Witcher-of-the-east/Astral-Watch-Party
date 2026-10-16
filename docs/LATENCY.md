# Latency measurements

Run it yourself: `node scripts/loadtest.js [clients] [commands]` (starts its own server on a free port).

## Method
* N bot clients connect over real WebSockets and join one room. The host bot sends `play`, `pause` and `seek`
  commands in rotation, 25 ms apart. Every other bot records `receive time − host send time`. Everything runs on one
  machine and one clock, so this is the **server + protocol cost only**. On the internet add roughly half the
  round-trip time between each person and the server.
* **Drift:** each bot also simulates a video player that starts up to ±4 s away from the truth and runs ±1 % fast or slow
  (like a late joiner on a flaky connection). It runs the *same correction function the browser uses* (`public/js/sync.js`)
  at 4 Hz. We sample its distance from the true position from t = 4 s onward.

## Results (localhost, Node 22, this repo at v1.0.0)

| Clients in room | Deliveries | Propagation p50 | p95 | p99 | max | Drift p50 | Drift p95 | Drift max |
|---|---|---|---|---|---|---|---|---|
| 12 | 671 | 1 ms | **1 ms** | 3 ms | 3 ms | 44 ms | **60 ms** | 62 ms |
| 25 | 1,464 | 1 ms | **2 ms** | 2 ms | 5 ms | 40 ms | **60 ms** | 63 ms |
| 50 | 4,459 | 1 ms | **3 ms** | 16 ms | 17 ms | 30 ms | **59 ms** | 72 ms |

Targets: control propagation p95 ≤ 250 ms ✔ (server share is a few ms, leaving the whole budget for the network),
drift after correction ≤ 500 ms ✔ (about 60 ms).

## Real browsers
A three-browser Chromium test (host + 2 guests, one joining late) measured the actual `<video>` elements:
after start the clients were within 0.01 s of each other, a seek propagated within 0.01 s, a guest knocked 5 s off was
back within 0.01 s about two seconds later, and the on-screen sync pill read −43 ms to −60 ms drift with 3–7 ms ping.

## Measure it with real friends
Every room shows a live pill under the video: `● In sync · 38 ms ping · drift −12 ms`. Screenshot that during a real
session over the internet and add it here. Note the localhost numbers above exclude your actual network.
