<div align="center">

# 🤖 Multi-Bot Orchestrator v16.0

[![Discord.js](https://img.shields.io/badge/orchestrator-v16.0-blue.svg?logo=discord&logoColor=white)](https://discord.js.org/)
[![Architecture](https://img.shields.io/badge/architecture-multi--process-orange.svg)]()
[![Node.js](https://img.shields.io/badge/node.js-%3E%3D18.0.0-green.svg?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-purple.svg)](./LICENSE)

A professional, high-performance **Multi-Bot Supervisor** and music engine. This is not just one bot—it is a complete orchestration platform designed to deploy, manage, and monitor an unlimited number of Discord music bots from a single system.

[Feature Tour](#✨-key-features) • [Multi-Bot System](#🤖-multi-bot-orchestration) • [CLI Management](#⌨️-music-cli) • [Installation](#🚀-getting-started) • [Support Server](https://discord.gg/tEHJZReZrs)

</div>

---

## 🏛️ The Architecture: More Than Just a Bot

Unlike standard music bots, this system is a **Rebuilt Orchestrator**. It uses a **Master Supervisor** to lifecycle-manage multiple bot instances, each running in its own isolated process for maximum stability and performance.

### 🤖 Multi-Bot Orchestration
The core of the system is the **Supervisor Engine** (`index.js`). 
- **Isolated Workers**: Each bot instance is `forked` into its own Node.js process. If one bot crashes, the others remain online, and the Supervisor automatically restarts the failed instance.
- **Database Driven**: Bot configurations, tokens, and allowed channels are fetched dynamically from a central database.
- **Centralized Cache**: All bots share the same high-performance `audio_cache`, but manage their own independent player states.
- **Scalability**: Run 1, 10, or 100+ bots simultaneously without code duplication.

### ⌨️ Music-CLI (The Management Terminal)
The **music-cli** is your powerful command-line interface to the entire ecosystem. It allows you to manage your bot army without touching a single code file.
- **Direct Management**: Add new bots to your database, update tokens, and change bot status (active/inactive) instantly.
- **Channel Control**: Bind specific bots to specific Discord channels with a single command.
- **Live Monitoring**: View the health and status of all running bots in real-time.
- **Automation**: Use the CLI to automate bot deployment and maintenance tasks.

---

## ✨ Key Features

### 💾 Local Audio Caching (The "Opus" Engine)
Never hear a stutter again. MusicBot downloads tracks to a local `audio_cache` directory in high-quality **Opus** format before streaming.
- **Zero Buffering**: Streams directly from local storage.
- **Preloading**: While you listen to one song, the bot is already downloading the next.
- **Disk Management**: Automatically cleans up files after playback to save space.

### 🎲 Smart Autoplay System
Keep the music flowing forever with our intelligent autoplay engine.
- **20+ Genres**: Select from Pop, Rock, Hip-Hop, Anime, Lo-Fi, and more.
- **Content Filtering**: Automatically skips non-music content like tutorials, podcasts, and long movies using duration and keyword filters.
- **High Retention**: Only picks high-quality official music videos or verified tracks.

### 📜 Professional Lyrics Manager
Get lyrics for any song directly in Discord with Genius and LRCLIB integration.
- **Multi-Source**: Fetches from Genius (with optional API) and falls back to LRCLIB.
- **Search Support**: Even for Arabic and non-English songs.
- **Pagination**: Browse through long lyrics with ease.

### 🛡️ Resilient Voice Engine
Engineered for uptime.
- **Auto-Recovery**: Monitors voice connection health and automatically reconnects if dropped.
- **State Persistence**: Saves volume, loop mode, and autoplay settings per server.
- **Self-Healing**: If a stream fails, the bot automatically retries or skips to the next track gracefully.

### 🌍 Global Localization
The bot speaks your language. Shipped with **21 language packs**, including Arabic, English, Spanish, French, Japanese, and more.

---

## 🛠️ Prerequisites & OS Setup

Before setting up the orchestrator, ensure your system has the following requirements:

### 🐧 Linux (Ubuntu/Debian)
1. **Install Node.js & Dependencies**:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs ffmpeg python3
   ```
2. **Install yt-dlp**:
   ```bash
   sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
   sudo chmod a+rx /usr/local/bin/yt-dlp
   ```

### 🪟 Windows
1. **Node.js**: Install from [nodejs.org](https://nodejs.org/).
2. **FFmpeg**: Download from [ffmpeg.org](https://ffmpeg.org/) and add the `bin` folder to your **System PATH**.
3. **yt-dlp**: Download `yt-dlp.exe` and place it in your System PATH.

---

## 🚀 Step-by-Step Usage Guide

Starting your own bot army is simple. Follow these steps to get your first bots online:

### 1. Initial Setup
Install the core dependencies and prepare your environment.
```bash
# Install dependencies
npm install

# Setup your environment (see .env section)
cp .env.example .env
```

### 2. Database Migration (One-Time)
The Orchestrator uses a database to store bot configurations and settings. Initialize it with:
```bash
npx sequelize-cli db:migrate
```

### 3. Add Your Bots via Music-CLI
This is where the magic happens. Use the interactive CLI to add your bot tokens to the system.
```bash
node music-cli/index.js
```
- **Select**: `➕ Add new bot`
- **Follow**: The prompts to enter the bot's name, token (or env key), and prefix.
- **Manage**: You can also use this CLI at any time to list, delete, or update your bots.

### 4. Launch the Orchestrator
Once your bots are added to the database, start the Master Supervisor:
```bash
npm start
# or
node index.js
```
The Supervisor will now check the database, spawn a dedicated process for every active bot, and log their status to the console.

---

## ⚙️ Configuration

Copy `.env.example` to `.env` and fill in your credentials:

```dotenv
# Core Settings
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_client_id_here
GUILD_ID=optional_for_fast_testing

# Branding
STATUS=🎵 Listening to Music | /help
EMBED_COLOR=#5865F2

# API Integrations
SPOTIFY_CLIENT_ID=your_spotify_id
SPOTIFY_CLIENT_SECRET=your_spotify_secret
GENIUS_CLIENT_ID=optional_genius_id
GENIUS_CLIENT_SECRET=optional_genius_secret

# YouTube Fixes
COOKIES_FILE=./cookies.txt # Recommended to prevent "Sign in" errors
```

### 🔓 External API Setup

- **Spotify**: Get your `CLIENT_ID` and `CLIENT_SECRET` from the [Spotify Dashboard](https://developer.spotify.com/dashboard). This enables search and playlist support.
- **Genius**: Get your credentials from the [Genius API Clients Page](https://genius.com/api-clients). This improves the speed and rate limits of the lyrics system.

### 🍪 YouTube Cookie Setup (Highly Recommended)
To prevent the "Sign in to confirm you're not a bot" error from YouTube:
1.  Install the **Get cookies.txt LOCALLY** extension in your browser.
2.  Go to YouTube, export your cookies as `cookies.txt`.
3.  Place the file in the bot's root directory.
4.  Set `COOKIES_FILE=./cookies.txt` in your `.env`.

---

## 🎮 Commands & Controls

| Command | Description |
| --- | --- |
| `/play` | Play music from YouTube, Spotify, SoundCloud, or Links. |
| `/search` | Search and select from multiple YouTube results. |
| `/nowplaying` | Displays elite playback UI with live progress and controls. |
| `/volume` | Set the bot's volume (0-100) via modal. |
| `/language` | Change the bot's language for your server instantly. |
| `/help` | See all commands and technical stats. |

### 🎛️ Interactive Controls
The `nowplaying` embed features real-time buttons:
- **Play/Pause**: Toggle playback.
- **Skip**: Jump to the next song.
- **Stop**: Clear queue and leave.
- **Loop**: Toggle Track Loop, Queue Loop, or Off.
- **Autoplay**: Activate the smart genre-based radio.
- **Queue**: View upcoming tracks.

---

## 🛠️ Technical Details

- **Framework**: Discord.js v14
- **Voice Library**: @discordjs/voice
- **Audio Engine**: prism-media / ffmpeg
- **Download Engine**: yt-dlp (via youtube-dl-exec)
- **Database**: Local JSON via `node-json-db` for settings persistence.

---

## 📜 Privacy & Legal

- **Data Privacy**: We only store Guild IDs and language preferences. No user-specific data or audio logs are ever kept.
- **License**: Released under the [MIT License](./LICENSE).

---

<div align="center">
Built with ❤️ for the Discord community.  
<b>Enjoying the bot? Give this repository a ⭐!</b>
</div>
