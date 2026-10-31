import { sql } from "drizzle-orm";
import {
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const discordRelayChannels = pgTable(
  "discord_relay_channels",
  {
    channelId: varchar("channel_id", { length: 32 }).primaryKey(),
    guildId: varchar("guild_id", { length: 32 }).notNull(),
    tag: varchar("tag", { length: 100 }).notNull(),
    channelType: varchar("channel_type", { length: 16 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("discord_relay_channels_by_tag").on(table.guildId, table.tag),
    uniqueIndex("discord_relay_channels_one_admin_per_tag")
      .on(table.guildId, table.tag)
      .where(sql`${table.channelType} = 'admin'`),
  ],
);

export const discordReactionRoleMappings = pgTable(
  "discord_reaction_role_mappings",
  {
    guildId: varchar("guild_id", { length: 32 }).notNull(),
    messageId: varchar("message_id", { length: 32 }).notNull(),
    channelId: varchar("channel_id", { length: 32 }).notNull(),
    emojiKey: varchar("emoji_key", { length: 128 }).notNull(),
    emojiDisplay: varchar("emoji_display", { length: 128 }).notNull(),
    roleId: varchar("role_id", { length: 32 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("discord_reaction_role_mappings_unique")
      .on(table.guildId, table.messageId, table.emojiKey),
    index("discord_reaction_role_mappings_by_message").on(
      table.guildId,
      table.messageId,
    ),
  ],
);

export const discordNicknamePanels = pgTable("discord_nickname_panels", {
  guildId: varchar("guild_id", { length: 32 }).notNull(),
  channelId: varchar("channel_id", { length: 32 }).primaryKey(),
  messageId: varchar("message_id", { length: 32 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
