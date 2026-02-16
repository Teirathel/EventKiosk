/**
 * Event Kiosk (Multi-Server) — bot.js
 * discord.js v14 (ESM)
 *
 * What this does:
 * - Admin runs /setupkiosk (with channel options) once per server
 * - Bot stores that server config in SQLite (via ./db.js)
 * - Users click a button -> modal popup -> Bot creates a Discord Scheduled Event + posts announcement
 *
 * ENV required:
 *   DISCORD_TOKEN=...
 * Optional:
 *   TIMEZONE=Europe/Luxembourg
 *
 * NOTE:
 * - You MUST also create db.js (I reference it below)
 * - You MUST register the /setupkiosk command as GLOBAL with channel options in register-commands.js
 */

import "dotenv/config";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { DateTime } from "luxon";
import { getGuildConfig, upsertGuildConfig } from "./db.js";

const TOKEN = process.env.DISCORD_TOKEN;
const TIMEZONE = process.env.TIMEZONE || "Europe/Luxembourg";

if (!TOKEN) {
  console.error("Missing env var: DISCORD_TOKEN");
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
  date: "event_date",
  time: "event_time",
  details: "event_details",
  link: "event_link",
};

const DEFAULT_DURATION_MINUTES = 120; // Discord requires end time for External events

// ---------- Helpers ----------
function normalizeInput(s) {
  if (!s) return "";
  return s
    .trim()
    // replace various dash characters with normal hyphen
    .replace(/[\u2012\u2013\u2014\u2015\u2212]/g, "-")
    // replace non-breaking spaces with normal space
    .replace(/\u00A0/g, " ")
    // remove zero-width characters
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

function parseDateTime(dateStr, timeStr) {
  const d = normalizeInput(dateStr);
  const t = normalizeInput(timeStr);

  // Acceptable date formats:
  // 1) YYYY-MM-DD
  // 2) DD.MM.YYYY
  // 3) DD/MM/YYYY
  // Also tolerate single-digit day/month (e.g. 2.3.2026)
  const dateFormats = ["yyyy-MM-dd", "d.M.yyyy", "d/M/yyyy"];

  // Acceptable time formats:
  // 1) HH:mm
  // 2) H:mm
  // 3) HH.mm
  // 4) 19h30
  // 5) 1930
  let t2 = t
    .toLowerCase()
    .replace("h", ":")
    .replace(".", ":");

  // If time is like "1930" => "19:30"
  if (/^\d{3,4}$/.test(t2)) {
    const padded = t2.padStart(4, "0");
    t2 = `${padded.slice(0, 2)}:${padded.slice(2)}`;
  }

  const timeFormats = ["HH:mm", "H:mm"];

  for (const df of dateFormats) {
    for (const tf of timeFormats) {
      const dt = DateTime.fromFormat(`${d} ${t2}`, `${df} ${tf}`, {
        zone: TIMEZONE,
        setZone: true,
      });
      if (dt.isValid) return dt;
    }
  }

  return null;
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

function buildAnnouncementEmbed({ title, startDt, endDt, details, link, createdBy }) {
  const startUnix = Math.floor(startDt.toSeconds());
  const endUnix = Math.floor(endDt.toSeconds());

  const embed = new EmbedBuilder()
    .setTitle(title)
    .addFields(
      {
        name: "When",
        value: `<t:${startUnix}:F> → <t:${endUnix}:t>\n(<t:${startUnix}:R>)`,
      },
      { name: "Organizer", value: `${createdBy}`, inline: true }
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

function isAllowedSetupChannel(ch) {
  // allow Text + Announcement channels as targets
  return (
    ch?.type === ChannelType.GuildText ||
    ch?.type === ChannelType.GuildAnnouncement
  );
}

// ---------- Ready ----------
client.once(Events.ClientReady, (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
});

// ---------- Interactions ----------
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // We only operate inside servers
    if (!interaction.guildId) return;

    // 1) /setupkiosk (admin-only) — saves per-server config + posts the kiosk message
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "setupkiosk") {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({
            flags: 64,
            content: "You need **Manage Server** to run this command.",
          });
        }

        const kioskChannel = interaction.options.getChannel("kiosk_channel", true);
        const announceChannel = interaction.options.getChannel("announce_channel", true);
        const role = interaction.options.getRole("events_role", false);

        if (!isAllowedSetupChannel(kioskChannel) || !isAllowedSetupChannel(announceChannel)) {
          return interaction.reply({
            flags: 64,
            content: "Please select valid **text/announcement channels** for kiosk + announcements.",
          });
        }

        // Save config for this guild
        upsertGuildConfig({
          guildId: interaction.guildId,
          kioskChannelId: kioskChannel.id,
          announceChannelId: announceChannel.id,
          eventsRoleId: role?.id ?? null,
        });

        // Post kiosk message
        const msg = await kioskChannel.send(buildKioskMessage());

        return interaction.reply({
          flags: 64,
          content: `✅ Configuration saved for this server.\n✅ Kiosk message posted: ${msg.url}`,
        });
      }
    }

    // 2) Button click -> show modal (requires server configured)
    if (interaction.isButton()) {
      if (interaction.customId !== IDS.kioskButton) return;

      const cfg = getGuildConfig(interaction.guildId);
      if (!cfg) {
        return interaction.reply({
          flags: 64,
          content: "❌ This server is not configured yet. An admin must run `/setupkiosk` first.",
        });
      }

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

    // 3) Modal submit -> create event + announce (uses per-server config)
    if (interaction.isModalSubmit()) {
      if (interaction.customId !== IDS.modal) return;

      const cfg = getGuildConfig(interaction.guildId);
      if (!cfg) {
        return interaction.reply({
          flags: 64,
          content: "❌ This server is not configured yet. An admin must run `/setupkiosk` first.",
        });
      }

      const title = interaction.fields.getTextInputValue(IDS.title).trim();
      const dateStr = interaction.fields.getTextInputValue(IDS.date).trim();
      const timeStr = interaction.fields.getTextInputValue(IDS.time).trim();
      const details = (interaction.fields.getTextInputValue(IDS.details) || "").trim();
      const link = (interaction.fields.getTextInputValue(IDS.link) || "").trim();

      // Validate date/time
      const startDt = parseDateTime(dateStr, timeStr);
      if (!startDt) {
        return interaction.reply({
          flags: 64,
          content:
  "❌ I couldn't read your date/time.\nUse one of these:\n" +
  "• Date: `YYYY-MM-DD` (2026-02-20) or `DD.MM.YYYY` (20.02.2026)\n" +
  "• Time: `HH:mm` (19:30) or `19h30`",

        });
      }

      const now = DateTime.now().setZone(TIMEZONE);
      if (startDt < now.plus({ minutes: 2 })) {
        return interaction.reply({
          flags: 64,
          content: "❌ That start time is too soon / in the past. Please choose a future time.",
        });
      }

      // Validate link
      if (!isValidUrl(link)) {
        return interaction.reply({
          flags: 64,
          content: "❌ Link must be a valid URL starting with `https://` (or leave it empty).",
        });
      }

      // End time required for External events
      const endDt = startDt.plus({ minutes: DEFAULT_DURATION_MINUTES });

      const location = link ? link : "Online";
      const scheduledStartTime = startDt.toJSDate();
      const scheduledEndTime = endDt.toJSDate();

      // Create scheduled event in THIS guild
      const guild = interaction.guild; // correct guild automatically
      const createdEvent = await guild.scheduledEvents.create({
        name: title,
        scheduledStartTime,
        scheduledEndTime,
        entityType: GuildScheduledEventEntityType.External,
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        description:
          [
            details ? details : null,
            link ? `Link: ${link}` : null,
          ]
            .filter(Boolean)
            .join("\n")
            .slice(0, 1000) || " ",
        entityMetadata: { location },
      });

      // Announce in configured channel
      const announceChannel = await client.channels.fetch(cfg.announce_channel_id);
      if (!announceChannel?.isTextBased()) {
        return interaction.reply({
          flags: 64,
          content:
            `⚠ Event created (${createdEvent.url}), but I couldn't post the announcement because the configured announcement channel is not accessible.`,
        });
      }

      const embed = buildAnnouncementEmbed({
        title,
        startDt,
        endDt,
        details,
        link,
        createdBy: interaction.user.toString(),
      });

      const ping = cfg.events_role_id ? `<@&${cfg.events_role_id}> ` : "";
      const announcement = await announceChannel.send({
        content: `${ping}📣 **New Event Created!**\n${createdEvent.url}`,
        embeds: [embed],
        allowedMentions: { roles: cfg.events_role_id ? [cfg.events_role_id] : [] },
      });

      return interaction.reply({
        flags: 64,
        content: `✅ Event created: ${createdEvent.url}\n✅ Announcement posted: ${announcement.url}`,
      });
    }
  } catch (err) {
    console.error(err);
    try {
      if (interaction?.isRepliable()) {
        const alreadyReplied = interaction.deferred || interaction.replied;
        const payload = {
          flags: 64,
          content: "❌ Something went wrong. Please try again, or ask an admin to check the bot logs.",
        };
        if (alreadyReplied) return interaction.followUp(payload);
        return interaction.reply(payload);
      }
    } catch (_) {
      // ignore
    }
  }
});

client.login(TOKEN);

