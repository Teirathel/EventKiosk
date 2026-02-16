import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "eventkiosk.db");
export const db = new Database(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS guild_config (
  guild_id TEXT PRIMARY KEY,
  kiosk_channel_id TEXT NOT NULL,
  announce_channel_id TEXT NOT NULL,
  events_role_id TEXT
);
`);

export function upsertGuildConfig({ guildId, kioskChannelId, announceChannelId, eventsRoleId }) {
  const stmt = db.prepare(`
    INSERT INTO guild_config (guild_id, kiosk_channel_id, announce_channel_id, events_role_id)
    VALUES (@guildId, @kioskChannelId, @announceChannelId, @eventsRoleId)
    ON CONFLICT(guild_id) DO UPDATE SET
      kiosk_channel_id=excluded.kiosk_channel_id,
      announce_channel_id=excluded.announce_channel_id,
      events_role_id=excluded.events_role_id
  `);
  stmt.run({ guildId, kioskChannelId, announceChannelId, eventsRoleId: eventsRoleId ?? null });
}

export function getGuildConfig(guildId) {
  const stmt = db.prepare(`SELECT * FROM guild_config WHERE guild_id = ?`);
  return stmt.get(guildId) || null;
}
