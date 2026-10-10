# APEX DRIFT 2D — Multiplayer Edition

This project includes the existing single-player game plus **private multiplayer rooms** (up to 8 drivers), room codes, player name labels, track synchronization, and live car positions. All 15 tracks, 20 cars, garage, tuning, drift scoring, and controller support are retained.

## Test on your PC

1. Install Node.js 18 or newer from https://nodejs.org/
2. Extract this ZIP, open a terminal in its folder.
3. Run `npm install` and then `npm start`.
4. Open **http://localhost:3000** in your browser.
5. For a second local test, open another browser window and join the same room code.

Opening `index.html` directly as a file will **not** connect to the multiplayer server.

## Publish online with Render (free tier where available)

1. Create a new GitHub repository and upload `index.html`, `server.js`, `package.json`, and `render.yaml` (or upload the whole unzipped folder).
2. Sign in to https://dashboard.render.com/ and create a **New Web Service** from the repository (or a Blueprint using `render.yaml`).
3. Choose **Node** runtime, **Free** instance if offered, build command `npm install`, start command `npm start`.
4. Deploy. Render provides an `https://...onrender.com` URL. Share that URL with friends.
5. In the game, press **M**, enter a name, **CREATE ROOM**, then share the six-character code. Friends visit the **same URL**, press M, enter the code and **JOIN ROOM**.

Render free services can sleep when idle, so the first load may take longer. Free-tier terms and availability can change. Only run one server instance because rooms live in the server's memory. Rooms vanish when the server restarts; car purchases and credits remain stored locally in each player's browser.

## How multiplayer works

- Up to 8 drivers in a room; only the host can switch tracks.
- Players can see other cars and driver names live. Each player's car physics and drift scoring run locally.
- Cars do not collide with one another. There is no server-side anti-cheat, global economy, login, chat, or permanent online leaderboards.
- A room code is a convenience privacy feature, not a secure password. Don't use real names.
- Game progress is saved by browser and website origin. Progress saved from an older `file://` version may not automatically appear on the hosted website.
