/**
 * ---------------------------
 * Command Registration Script
 * ---------------------------
 * Discord requires chat input commands to be registered.
 * Easiest way: create a second file called `register-commands.js`
 * with the code below, run it once, then keep `bot.js` running.
 *
 * (You can also register globally, but guild registration is instant.)
 *
 * Save as register-commands.js and run:
 *   node register-commands.js
 */

// --- register-commands.js ---
import "dotenv/config";
import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType } from "discord.js";

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error("Missing env vars: DISCORD_TOKEN, CLIENT_ID");
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName("setupkiosk")
    .setDescription("Configure this server and post the Event Kiosk button panel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o =>
      o.setName("kiosk_channel")
        .setDescription("Channel where the kiosk button panel will be posted")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
    .addChannelOption(o =>
      o.setName("announce_channel")
        .setDescription("Channel where event announcements will be posted")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
    .addRoleOption(o =>
      o.setName("events_role")
        .setDescription("Optional role to ping for new events")
        .setRequired(false)
    )
    .toJSON(),
];

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  try {
    console.log("Registering global commands...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ Global commands registered.");
  } catch (e) {
    console.error(e);
  }
})();
