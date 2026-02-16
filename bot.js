/**
 * Discord "Event Kiosk" Bot (discord.js v14)
 *
 * Features:
 * - Posts a fixed kiosk message with a button ("Create Event")
 * - Button opens a Modal (popup) to collect: title, date, time, details, link (optional)
 * - On submit:
 *    1) Creates a Discord Scheduled Event (External)
 *    2) Posts an announcement embed in a chosen channel (optional role ping)
 *
 * Requirements:
 * - Node.js 18+
 * - discord.js v14
 *
 * ENV (.env):
 *   DISCORD_TOKEN=...
 *   GUILD_ID=...
 *   KIOSK_CHANNEL_ID=...
 *   ANNOUNCE_CHANNEL_ID=...
 *   EVENTS_ROLE_ID=...   (optional; role to ping)
 *   TIMEZONE=Europe/Luxembourg (optional; default)
 *
 * Bot permissions:
 * - Manage Events (for creating scheduled events)
 * - Send Messages + Embed Links (announce + kiosk channels)
 * - View Channels (kiosk + announce)
 *
 * Setup:
 *   npm i discord.js dotenv luxon
 *   node bot.js
 */

import "dotenv/config";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { DateTime } from "luxon";

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const KIOSK_CHANNEL_ID = process.env.KIOSK_CHANNEL_ID;
const ANNOUNCE_CHANNEL_ID = process.env.ANNOUNCE_CHANNEL_ID;
const EVENTS_ROLE_ID = process.env.EVENTS_ROLE_ID || null;
const TIMEZONE = process.env.TIMEZONE || "Europe/Luxembourg";

if (!TOKEN || !GUILD_ID || !KIOSK_CHANNEL_ID || !ANNOUNCE_CHANNEL_ID) {
  console.error(
    "Missing env vars. Required: DISCORD_TOKEN, GUILD_ID, KIOSK_CHANNEL_ID, ANNOUNCE_CHANNEL_ID"
  );
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const IDS = {
  kioskButton: "kiosk_create_event",
  modal: "kiosk_event_modal",

  // modal inputs
  title: "event_title",
  date: "event_date", // YYYY-MM-DD
  time: "event_time", // HH:mm
  details: "event_details",
  link: "event_link",
};

// ---------- Helpers ----------
function parseDateTime(dateStr, timeStr) {
  // Expect dateStr: YYYY-MM-DD, timeStr: HH:mm (24h)
  const dt = DateTime.fromFormat(`${dateStr} ${timeStr}`, "yyyy-MM-dd HH:mm", {
    zone: TIMEZONE,
    setZone: true,
  });
  return dt.isValid ? dt : null;
}

function isValidUrl(s) {
  if (!s) return true; // empty allowed
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function buildKioskMessage() {
  const embed = new EmbedBuilder()
    .setTitle("Create an Event")
    .setDescription(
      [
        "Click the button below to create a new event.",
        "",
        "**Format notes**",
        `• Date: \`YYYY-MM-DD\` (e.g. \`2026-02-20\`)`,
        `• Time: \`HH:mm\` 24h (e.g. \`19:30\`)`,
        `• Timezone: **${TIMEZONE}**`,
      ].join("\n")
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(IDS.kioskButton)
      .setLabel("Create Event")
      .setStyle(ButtonStyle.Primary)
  );

  return { embeds: [embed], components: [row] };
}

function buildAnnouncementEmbed({ title, startDt, details, link, createdBy }) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .addFields(
      {
        name: "When",
        value: `<t:${Math.floor(startDt.toSeconds())}:F>  (<t:${Math.floor(
          startDt.toSeconds()
        )}:R>)`,
      },
      {
        name: "Organizer",
        value: `${createdBy}`,
        inline: true,
      }
    )
    .setFooter({ text: `Timezone: ${TIMEZONE}` });

  if (details?.trim()) {
    embed.addFields({ name: "Details", value: details.trim().slice(0, 1024) });
  }
  if (link?.trim()) {
    embed.addFields({ name: "Link", value: link.trim().slice(0, 1024) });
  }

  return embed;
}

// ---------- Slash command (simple, built-in) ----------
// We’ll register ONE command via Discord UI-less approach: a "message command" isn't needed.
// Instead, we implement a chat input command handler for /setupkiosk.
// NOTE: You still need to register the command once (script included at bottom).

const COMMANDS = {
  setupkiosk: "setupkiosk",
};

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
});

// ---------- Interactions ----------
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // 1) /setupkiosk (admin-only)
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === COMMANDS.setupkiosk) {
        if (
          !interaction.memberPermissions?.has(
            PermissionFlagsBits.ManageGuild
          )
        ) {
          return interaction.reply({
            ephemeral: true,
            content: "You need **Manage Server** to run this command.",
          });
        }

        const kioskChannel = await client.channels.fetch(KIOSK_CHANNEL_ID);
        if (!kioskChannel?.isTextBased()) {
          return interaction.reply({
            ephemeral: true,
            content:
              "KIOSK_CHANNEL_ID is not a text channel I can post in.",
          });
        }

        const msg = await kioskChannel.send(buildKioskMessage());

        return interaction.reply({
          ephemeral: true,
          content: `✅ Kiosk message posted: ${msg.url}`,
        });
      }
    }

    // 2) Button click -> show modal
    if (interaction.isButton()) {
      if (interaction.customId !== IDS.kioskButton) return;

      const modal = new ModalBuilder()
        .setCustomId(IDS.modal)
        .setTitle("Create a Discord Event");

      const titleInput = new TextInputBuilder()
        .setCustomId(IDS.title)
        .setLabel("Title")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);

      const dateInput = new TextInputBuilder()
        .setCustomId(IDS.date)
        .setLabel("Date (YYYY-MM-DD)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder("2026-02-20")
        .setMaxLength(10);

      const timeInput = new TextInputBuilder()
        .setCustomId(IDS.time)
        .setLabel("Time (HH:mm, 24h)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder("19:30")
        .setMaxLength(5);

      const detailsInput = new TextInputBuilder()
        .setCustomId(IDS.details)
        .setLabel("Details (optional)")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(1000);

      const linkInput = new TextInputBuilder()
        .setCustomId(IDS.link)
        .setLabel("Link (optional, https://...)")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(200);

      modal.addComponents(
        new ActionRowBuilder().addComponents(titleInput),
        new ActionRowBuilder().addComponents(dateInput),
        new ActionRowBuilder().addComponents(timeInput),
        new ActionRowBuilder().addComponents(detailsInput),
        new ActionRowBuilder().addComponents(linkInput)
      );

      return interaction.showModal(modal);
    }

    // 3) Modal submit -> create event + announce
    if (interaction.isModalSubmit()) {
      if (interaction.customId !== IDS.modal) return;

      const title = interaction.fields.getTextInputValue(IDS.title).trim();
      const dateStr = interaction.fields.getTextInputValue(IDS.date).trim();
      const timeStr = interaction.fields.getTextInputValue(IDS.time).trim();
      const details =
        interaction.fields.getTextInputValue(IDS.details)?.trim() || "";
      const link =
        interaction.fields.getTextInputValue(IDS.link)?.trim() || "";

      // Validate date/time
      const startDt = parseDateTime(dateStr, timeStr);
      if (!startDt) {
        return interaction.reply({
          ephemeral: true,
          content:
            "❌ I couldn't read your date/time.\nUse:\n• Date: `YYYY-MM-DD` (e.g. `2026-02-20`)\n• Time: `HH:mm` 24h (e.g. `19:30`)",
        });
      }
      if (startDt < DateTime.now().setZone(TIMEZONE).plus({ minutes: 2 })) {
        return interaction.reply({
          ephemeral: true,
          content:
            "❌ That start time is too soon / in the past. Please choose a future time (at least a few minutes ahead).",
        });
      }

      // Validate link
      if (!isValidUrl(link)) {
        return interaction.reply({
          ephemeral: true,
          content:
            "❌ Link must be a valid URL starting with `https://` (or leave it empty).",
        });
      }

      // Prepare fields for Discord event
      const guild = await client.guilds.fetch(GUILD_ID);

      // Discord scheduled events require a Date object (UTC inside)
      const scheduledStartTime = startDt.toJSDate();

      // For external events, Discord requires: entityType: External, and a location.
      // We'll set "Online" unless link exists (then use link as location).
      const location = link ? link : "Online";

      // Create the scheduled event
      const endDt = startDt.plus({ hours: 2 });
      const scheduledEndTime = endDt.toJSDate();

      const createdEvent = await guild.scheduledEvents.create({
        name: title,
        scheduledStartTime,
        scheduledEndTime,              // ✅ REQUIRED for External events
        entityType: 3,                 // External
        privacyLevel: 2,               // GuildOnly
        description: [
          details ? details : null,
          link ? `Link: ${link}` : null,
        ].filter(Boolean).join("\n").slice(0, 1000) || " ",
        entityMetadata: { location },
      });

      // Announce in channel
      const announceChannel = await client.channels.fetch(
        ANNOUNCE_CHANNEL_ID
      );
      if (!announceChannel?.isTextBased()) {
        return interaction.reply({
          ephemeral: true,
          content:
            "⚠ Event created, but I couldn't post the announcement because ANNOUNCE_CHANNEL_ID is not a text channel.",
        });
      }

      const embed = buildAnnouncementEmbed({
        title,
        startDt,
        details,
        link,
        createdBy: interaction.user.toString(),
      });

      const ping = EVENTS_ROLE_ID ? `<@&${EVENTS_ROLE_ID}> ` : "";
      const announcement = await announceChannel.send({
        content: `${ping}📣 **New Event Created!**\n${createdEvent.url}`,
        embeds: [embed],
        allowedMentions: {
          roles: EVENTS_ROLE_ID ? [EVENTS_ROLE_ID] : [],
        },
      });

      return interaction.reply({
        ephemeral: true,
        content:
          `✅ Event created: ${createdEvent.url}\n` +
          `✅ Announcement posted: ${announcement.url}`,
      });
    }
  } catch (err) {
    console.error(err);
    if (interaction?.isRepliable()) {
      const alreadyReplied = interaction.deferred || interaction.replied;
      const payload = {
        ephemeral: true,
        content:
          "❌ Something went wrong. Please try again, or ask an admin to check the bot logs.",
      };
      if (alreadyReplied) return interaction.followUp(payload);
      return interaction.reply(payload);
    }
  }
});

client.login(TOKEN);
