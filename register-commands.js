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
import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from "discord.js";

 const TOKEN = process.env.DISCORD_TOKEN;
 const CLIENT_ID = process.env.CLIENT_ID; // your application client id
 const GUILD_ID = process.env.GUILD_ID;

 if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
   console.error("Missing env vars: DISCORD_TOKEN, CLIENT_ID, GUILD_ID");
   process.exit(1);
 }

 const commands = [
   new SlashCommandBuilder()
     .setName("setupkiosk")
     .setDescription("Post the event creation kiosk message in the kiosk channel.")
     .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
     .toJSON(),
 ];

 const rest = new REST({ version: "10" }).setToken(TOKEN);

 (async () => {
   try {
     console.log("Registering guild commands...");
     await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
       body: commands,
     });
     console.log("✅ Commands registered.");
   } catch (e) {
     console.error(e);
   }
 })();