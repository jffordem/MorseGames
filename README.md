# Morse Games

A browser-based Morse code (CW) trainer for amateur radio operators. Practice copying
characters, words, and realistic ham radio exchanges — all in your browser, no radio or
antenna required.

## Trying it out (Docker — no dev environment needed)

The easiest way to run Morse Games is with Docker. You don't need Node.js or any other
development tools installed.

### 1. Install Docker Desktop

Download and install **Docker Desktop** for your operating system:

- **Windows:** https://docs.docker.com/desktop/install/windows-install/
- **Mac:** https://docs.docker.com/desktop/install/mac-install/
- **Linux:** https://docs.docker.com/desktop/install/linux/

After installing, launch Docker Desktop and wait for it to finish starting up (the whale
icon in your system tray/menu bar will stop animating).

### 2. Get the code

If you have Git installed:

```bash
git clone https://github.com/jffordem/MorseGames.git
cd MorseGames
```

Or download the ZIP from the GitHub page (green **Code** button → **Download ZIP**),
then unzip it and open a terminal in that folder.

### 3. Build and run

```bash
docker compose up --build
```

This builds the app and starts a local web server. The first run takes a minute or two
to download dependencies and compile; subsequent runs are faster.

You'll know it's ready when you see output like:

```
morse-games  | /docker-entrypoint.sh: Configuration complete; ready for start up
```

### 4. Open in your browser

Navigate to **http://localhost:4080** in Chrome or Firefox.

### Stopping the app

Press `Ctrl+C` in the terminal to stop the server. To restart it later (without
rebuilding):

```bash
docker compose up
```

---

## Training modes

- **Random Run** — Hear a character, type it. Koch-method progression unlocks new
  characters as accuracy builds.
- **Word Wrangler** — Hear a word, type it. Word list is filtered to only include words
  you can form with your current Koch character set.
- **Contest** — Run a Field Day contest: call CQ (or QRZ), work callers, and copy their
  exchange to log it. Tune to an available 20m frequency first — no fixed time limit,
  just work as many contacts as you like.
- **Reading** — Passive listening to public-domain texts (Aesop, Gettysburg Address,
  Alice in Wonderland). Bookmarks your place between sessions.
- **Adventure** — A narrative radio-shack mission: tune to HQ, copy orders, and encode
  reports as a WWII coastwatcher. Multiple missions to choose from, freely replayable.

## Settings

Character speed, Farnsworth effective speed, tone frequency, and Koch level are all
adjustable and saved automatically between sessions.

---

## For developers

```bash
npm install
npm run dev      # Dev server at http://localhost:4080 with hot reload
npm run build    # TypeScript check + Vite production build → dist/
```

See [PROJECT-PLAN.md](PROJECT-PLAN.md) for the full feature roadmap and design notes.
