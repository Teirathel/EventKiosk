# Event Kiosk (Discord Bot)

A simple “kiosk-style” Discord bot for creating server events **without commands**.

Users click a **button**, fill a **popup form (modal)** with title/date/time/details/link, and the bot will:
1) Create a **Discord Scheduled Event**
2) Post an **announcement message** (embed) in a chosen channel (optional role ping)

## Features
- Button-based UI (no slash commands needed for end-users)
- Modal form inputs: Title, Date, Time, Details (optional), Link (optional)
- Creates a Discord Scheduled Event (External)
- Posts a formatted announcement embed + event link
- Optional role ping (e.g. `@Events`)
- Timezone-aware parsing (default: Europe/Luxembourg)

## Requirements
- Node.js **20 LTS** recommended
- Discord server permissions for the bot:
  - **Manage Events**
  - **Send Messages**
  - **Embed Links**
  - View access to kiosk & announcement channels

## Install (Local)
```bash
npm install
