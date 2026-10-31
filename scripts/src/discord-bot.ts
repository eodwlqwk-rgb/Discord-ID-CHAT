import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  Partials,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type Message,
  type MessageReaction,
  type ModalSubmitInteraction,
  type NewsChannel,
  type PartialMessageReaction,
  type Role,
  type TextChannel,
} from "discord.js";
import { config as loadEnvironment } from "dotenv";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { commandBuilders } from "./discord-bot-commands";
import {
  flushBotStore,
  loadBotStore,
  readBotStore,
  updateBotStore,
} from "./discord-bot-store";

loadEnvironment({
  path: fileURLToPath(new URL("../../.env", import.meta.url)),
});

const logger = pino({
  name: "discord-bot",
  level: process.env.LOG_LEVEL ?? "info",
});

const botToken = process.env.DISCORD_BOT_TOKEN;
if (!botToken) {
  throw new Error(
    "DISCORD_BOT_TOKEN is required. Add it to the project-root .env file.",
  );
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

type StandardTextChannel = TextChannel | NewsChannel;

function isStandardTextChannel(
  channel: unknown,
): channel is StandardTextChannel {
  if (!channel || typeof channel !== "object" || !("type" in channel)) {
    return false;
  }
  return (
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.GuildAnnouncement
  );
}

function normalizedTag(rawTag: string): string | null {
  const tag = rawTag.trim().normalize("NFC");
  if (!tag || Array.from(tag).length > 100) return null;
  return tag;
}

function discordErrorCode(error: unknown): number | string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as {
    code?: unknown;
    rawError?: { code?: unknown };
  };
  const code = candidate.code ?? candidate.rawError?.code;
  return typeof code === "number" || typeof code === "string"
    ? code
    : undefined;
}

type PrivateReplyInteraction = Pick<
  ChatInputCommandInteraction,
  "replied" | "deferred" | "reply" | "followUp"
> &
  Partial<
    Pick<ButtonInteraction | ModalSubmitInteraction, "replied" | "deferred">
  >;

function hasAdministratorPermission(
  interaction: ChatInputCommandInteraction,
): boolean {
  return (
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ??
    false
  );
}

async function replyPrivately(
  interaction: PrivateReplyInteraction,
  content: string,
): Promise<void> {
  const options = {
    content,
    ephemeral: true as const,
    allowedMentions: { parse: [] as [] },
  };
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(options);
  } else {
    await interaction.reply(options);
  }
}

async function registerCommandsForGuild(guild: Guild): Promise<void> {
  try {
    const commands = commandBuilders.map((builder) => builder.toJSON());
    await guild.commands.set(commands);
    logger.info(
      { guildId: guild.id, commandCount: commands.length },
      "Replaced server slash commands with the current bot commands",
    );
  } catch (error) {
    logger.error(
      { guildId: guild.id, code: discordErrorCode(error) },
      "Could not register slash commands for this server",
    );
  }
}

async function configureRelayChannel(
  interaction: ChatInputCommandInteraction,
  channelType: "input" | "admin",
): Promise<void> {
  if (!interaction.guildId || !interaction.guild || !interaction.channelId) {
    await replyPrivately(interaction, "서버 안에서만 사용할 수 있습니다.");
    return;
  }
  if (!isStandardTextChannel(interaction.channel)) {
    await replyPrivately(
      interaction,
      "일반 텍스트 채널 또는 공지 채널에서 실행해 주세요.",
    );
    return;
  }

  const tag = normalizedTag(interaction.options.getString("태그", true));
  if (!tag) {
    await replyPrivately(interaction, "태그는 1~100자까지 입력할 수 있습니다.");
    return;
  }

  const saved = await updateBotStore((draft) => {
    const duplicateAdmin =
      channelType === "admin" &&
      draft.relayChannels.some(
        (record) =>
          record.guildId === interaction.guildId &&
          record.tag === tag &&
          record.channelType === "admin" &&
          record.channelId !== interaction.channelId,
      );
    if (duplicateAdmin) return false;

    const record = {
      channelId: interaction.channelId!,
      guildId: interaction.guildId!,
      tag,
      channelType,
      updatedAt: new Date().toISOString(),
    };
    const existingIndex = draft.relayChannels.findIndex(
      (item) => item.channelId === interaction.channelId,
    );
    if (existingIndex === -1) draft.relayChannels.push(record);
    else draft.relayChannels[existingIndex] = record;
    return true;
  });

  if (!saved) {
    await replyPrivately(
      interaction,
      "같은 태그의 관리자 수신 채널이 이미 등록되어 있습니다.",
    );
    return;
  }

  const kind = channelType === "input" ? "입력 채널" : "관리자 수신 채널";
  await replyPrivately(
    interaction,
    `현재 채널을 ${kind}로 등록했습니다. 태그: \`${tag}\``,
  );
}

async function changeOrDeleteTag(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId || !interaction.channelId) {
    await replyPrivately(interaction, "서버 안에서만 사용할 수 있습니다.");
    return;
  }

  const configuration = (await readBotStore()).relayChannels.find(
    (record) =>
      record.guildId === interaction.guildId &&
      record.channelId === interaction.channelId,
  );
  if (!configuration) {
    await replyPrivately(
      interaction,
      "현재 채널에는 등록된 전달 태그가 없습니다.",
    );
    return;
  }

  if (interaction.options.getSubcommand() === "삭제") {
    await updateBotStore((draft) => {
      draft.relayChannels = draft.relayChannels.filter(
        (record) =>
          record.guildId !== interaction.guildId ||
          record.channelId !== interaction.channelId,
      );
    });
    await replyPrivately(
      interaction,
      "현재 채널의 전달 설정을 삭제했습니다. 다른 채널 설정은 유지됩니다.",
    );
    return;
  }

  const newTag = normalizedTag(interaction.options.getString("태그", true));
  if (!newTag) {
    await replyPrivately(interaction, "태그는 1~100자까지 입력할 수 있습니다.");
    return;
  }

  const changed = await updateBotStore((draft) => {
    const record = draft.relayChannels.find(
      (item) =>
        item.guildId === interaction.guildId &&
        item.channelId === interaction.channelId,
    );
    if (!record) return false;

    const duplicateAdmin =
      record.channelType === "admin" &&
      draft.relayChannels.some(
        (item) =>
          item.guildId === interaction.guildId &&
          item.tag === newTag &&
          item.channelType === "admin" &&
          item.channelId !== interaction.channelId,
      );
    if (duplicateAdmin) return false;

    record.tag = newTag;
    record.updatedAt = new Date().toISOString();
    return true;
  });
  if (!changed) {
    await replyPrivately(
      interaction,
      "같은 태그의 관리자 수신 채널이 이미 등록되어 있습니다.",
    );
    return;
  }
  await replyPrivately(
    interaction,
    `현재 채널의 태그를 \`${newTag}\`(으)로 변경했습니다.`,
  );
}

function emojiKey(reaction: MessageReaction): string | null {
  return reaction.emoji.id ?? reaction.emoji.name ?? null;
}

async function addReactionRole(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guild = interaction.guild;
  if (!guild || !interaction.channelId) {
    await replyPrivately(interaction, "서버 안에서만 사용할 수 있습니다.");
    return;
  }
  if (!isStandardTextChannel(interaction.channel)) {
    await replyPrivately(
      interaction,
      "역할 반응을 등록할 메시지가 있는 텍스트 채널에서 실행해 주세요.",
    );
    return;
  }

  const messageId = interaction.options.getString("message_id", true).trim();
  if (!/^\d{17,20}$/.test(messageId)) {
    await replyPrivately(interaction, "올바른 Discord 메시지 ID를 입력해 주세요.");
    return;
  }

  const roleOption = interaction.options.getRole("role", true);
  const selectedRole = await guild.roles.fetch(roleOption.id);
  if (!selectedRole || selectedRole.id === guild.id) {
    await replyPrivately(interaction, "이 서버의 지급 가능한 역할을 선택해 주세요.");
    return;
  }

  const botMember = guild.members.me ?? (await guild.members.fetchMe());
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await replyPrivately(
      interaction,
      "봇에 역할 관리(Manage Roles) 권한이 필요합니다.",
    );
    return;
  }
  if (selectedRole.managed || botMember.roles.highest.comparePositionTo(selectedRole) <= 0) {
    await replyPrivately(
      interaction,
      "봇의 역할이 지급할 역할보다 위에 있어야 합니다.",
    );
    return;
  }

  const channelPermissions = interaction.channel.permissionsFor(botMember);
  if (
    !channelPermissions?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.AddReactions,
    ])
  ) {
    await replyPrivately(
      interaction,
      "이 채널에서 메시지 보기, 기록 읽기, 반응 추가 권한이 필요합니다.",
    );
    return;
  }

  let targetMessage: Message;
  try {
    targetMessage = await interaction.channel.messages.fetch(messageId);
  } catch {
    await replyPrivately(
      interaction,
      "메시지를 찾을 수 없습니다. 명령어를 대상 메시지와 같은 채널에서 실행해 주세요.",
    );
    return;
  }
  if (targetMessage.guildId !== guild.id) {
    await replyPrivately(interaction, "이 서버의 메시지만 등록할 수 있습니다.");
    return;
  }

  const emojiDisplay = interaction.options.getString("emoji", true).trim();
  if (!emojiDisplay) {
    await replyPrivately(interaction, "기본 또는 서버 커스텀 이모지를 입력해 주세요.");
    return;
  }

  let reaction: MessageReaction;
  try {
    reaction = await targetMessage.react(emojiDisplay);
  } catch {
    await replyPrivately(
      interaction,
      "이모지 반응을 추가하지 못했습니다. 이모지와 봇의 채널 권한을 확인해 주세요.",
    );
    return;
  }

  const key = emojiKey(reaction);
  if (!key) {
    await replyPrivately(interaction, "이모지를 확인할 수 없어 설정을 저장하지 못했습니다.");
    return;
  }

  await updateBotStore((draft) => {
    const record = {
      guildId: guild.id,
      messageId: targetMessage.id,
      channelId: targetMessage.channelId,
      emojiKey: key,
      emojiDisplay,
      roleId: selectedRole.id,
      updatedAt: new Date().toISOString(),
    };
    const existingIndex = draft.reactionRoleMappings.findIndex(
      (item) =>
        item.guildId === guild.id &&
        item.messageId === targetMessage.id &&
        item.emojiKey === key,
    );
    if (existingIndex === -1) draft.reactionRoleMappings.push(record);
    else draft.reactionRoleMappings[existingIndex] = record;
  });

  await replyPrivately(
    interaction,
    `메시지에 ${emojiDisplay} 반응을 등록하고 \`${selectedRole.name}\` 역할과 연결했습니다.`,
  );
}

function nicknamePanelPayload() {
  const embed = new EmbedBuilder()
    .setTitle("✎ 닉네임 변경 ✎")
    .setDescription("치지직 닉네임을 입력해 주세요.");
  const button = new ButtonBuilder()
    .setCustomId("discord-nickname:open")
    .setLabel("닉네임 변경!")
    .setStyle(ButtonStyle.Primary);
  const row =
    new ActionRowBuilder<ButtonBuilder>().addComponents(button);
  return {
    embeds: [embed],
    components: [row],
  };
}

function isNicknamePanelMessage(message: Message): boolean {
  return (
    message.author.id === client.user?.id &&
    message.components.some(
      (row) =>
        "components" in row &&
        row.components.some(
          (component) =>
            "customId" in component &&
            component.customId === "discord-nickname:open",
        ),
    )
  );
}

async function saveNicknamePanel(
  guildId: string,
  channelId: string,
  messageId: string,
): Promise<void> {
  await updateBotStore((draft) => {
    const panel = {
      guildId,
      channelId,
      messageId,
      updatedAt: new Date().toISOString(),
    };
    const existingIndex = draft.nicknamePanels.findIndex(
      (item) => item.channelId === channelId,
    );
    if (existingIndex === -1) draft.nicknamePanels.push(panel);
    else draft.nicknamePanels[existingIndex] = panel;
  });
}

async function refreshNicknamePanels(): Promise<void> {
  const panels = (await readBotStore()).nicknamePanels;
  for (const panel of panels) {
    const guild = client.guilds.cache.get(panel.guildId);
    if (!guild) continue;

    try {
      const channel = await guild.channels.fetch(panel.channelId);
      if (!channel || !isStandardTextChannel(channel)) continue;
      const message = await channel.messages.fetch(panel.messageId);
      if (message.author.id !== client.user?.id) continue;
      await message.edit(nicknamePanelPayload());
      logger.info(
        { guildId: guild.id, channelId: channel.id, messageId: message.id },
        "Updated nickname panel appearance",
      );
    } catch (error) {
      logger.warn(
        {
          guildId: guild.id,
          channelId: panel.channelId,
          messageId: panel.messageId,
          code: discordErrorCode(error),
        },
        "Could not update a saved nickname panel",
      );
    }
  }
}

async function publishNicknamePanel(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guild = interaction.guild;
  if (!guild || !interaction.guildId || !interaction.channelId) {
    await replyPrivately(interaction, "서버 안에서만 사용할 수 있습니다.");
    return;
  }
  if (!isStandardTextChannel(interaction.channel)) {
    await replyPrivately(
      interaction,
      "별명 변경 안내를 게시할 텍스트 채널에서 실행해 주세요.",
    );
    return;
  }

  const savedPanel = (await readBotStore()).nicknamePanels.find(
    (panel) =>
      panel.guildId === interaction.guildId &&
      panel.channelId === interaction.channelId,
  );

  let existingMessage: Message | undefined;
  if (savedPanel) {
    try {
      const fetched = await interaction.channel.messages.fetch(
        savedPanel.messageId,
      );
      if (isNicknamePanelMessage(fetched)) existingMessage = fetched;
    } catch (error) {
      const code = discordErrorCode(error);
      if (code !== 10008 && code !== "10008") {
        await replyPrivately(
          interaction,
          "기존 안내 메시지를 확인하거나 갱신하지 못했습니다. 봇의 채널 권한을 확인해 주세요.",
        );
        return;
      }
    }
  }

  if (!existingMessage) {
    try {
      const recentMessages = await interaction.channel.messages.fetch({
        limit: 100,
      });
      existingMessage = recentMessages.find(isNicknamePanelMessage);
    } catch {
      await replyPrivately(
        interaction,
        "기존 안내 메시지를 확인하지 못했습니다. 봇의 메시지 기록 읽기 권한을 확인해 주세요.",
      );
      return;
    }
  }

  if (existingMessage) {
    await existingMessage.edit(nicknamePanelPayload());
    await saveNicknamePanel(
      interaction.guildId,
      interaction.channelId,
      existingMessage.id,
    );
    await replyPrivately(
      interaction,
      "기존 별명 변경 안내 메시지를 갱신했습니다.",
    );
    return;
  }

  const createdMessage = await interaction.channel.send(
    nicknamePanelPayload(),
  );
  try {
    await saveNicknamePanel(
      interaction.guildId,
      interaction.channelId,
      createdMessage.id,
    );
  } catch (error) {
    await createdMessage.delete().catch(() => undefined);
    throw error;
  }

  await replyPrivately(
    interaction,
    "별명 변경 안내 메시지를 현재 채널에 게시했습니다.",
  );
}

async function handleChatCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!hasAdministratorPermission(interaction)) {
    await replyPrivately(interaction, "서버 관리자만 사용할 수 있습니다.");
    return;
  }

  if (interaction.commandName === "전달") {
    const subcommand = interaction.options.getSubcommand();
    await configureRelayChannel(
      interaction,
      subcommand === "입력" ? "input" : "admin",
    );
    return;
  }
  if (interaction.commandName === "태그") {
    await changeOrDeleteTag(interaction);
    return;
  }
  if (interaction.commandName === "역할") {
    await addReactionRole(interaction);
    return;
  }
  if (interaction.commandName === "별명") {
    await publishNicknamePanel(interaction);
  }
}

function splitIntoDiscordMessages(text: string, limit = 2000): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const character of text) {
    if (current.length + character.length > limit) {
      chunks.push(current);
      current = "";
    }
    current += character;
  }
  if (current || chunks.length === 0) chunks.push(current);
  return chunks;
}

async function forwardMessage(message: Message): Promise<void> {
  if (
    !message.guild ||
    message.author.bot ||
    message.webhookId ||
    !isStandardTextChannel(message.channel)
  ) {
    return;
  }

  const relayChannels = (await readBotStore()).relayChannels;
  const source = relayChannels.find(
    (record) =>
      record.guildId === message.guild!.id &&
      record.channelId === message.channelId &&
      record.channelType === "input",
  );
  if (!source) return;

  const destination = relayChannels.find(
    (record) =>
      record.guildId === message.guild!.id &&
      record.tag === source.tag &&
      record.channelType === "admin",
  );
  if (!destination) return;

  const botMember =
    message.guild.members.me ?? (await message.guild.members.fetchMe());
  const sourcePermissions = message.channel.permissionsFor(botMember);
  if (!sourcePermissions?.has(PermissionFlagsBits.ManageMessages)) {
    logger.warn(
      { guildId: message.guild.id, channelId: message.channelId },
      "Cannot relay because Manage Messages is missing in the input channel",
    );
    return;
  }

  const targetChannel = await message.guild.channels.fetch(
    destination.channelId,
  );
  if (!targetChannel || !isStandardTextChannel(targetChannel)) {
    logger.warn(
      {
        guildId: message.guild.id,
        channelId: destination.channelId,
      },
      "Configured relay destination is unavailable",
    );
    return;
  }

  const targetPermissions = targetChannel.permissionsFor(botMember);
  if (
    !targetPermissions?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
    ])
  ) {
    logger.warn(
      { guildId: message.guild.id, channelId: destination.channelId },
      "Cannot relay because view or send permission is missing in the admin channel",
    );
    return;
  }

  const authorName =
    message.member?.displayName ??
    message.author.globalName ??
    message.author.username;
  const body = [
    message.content,
    ...message.attachments.map((attachment) => attachment.url),
  ]
    .filter(Boolean)
    .join("\n");
  const prefix = `#${message.channel.name.replace(/[\r\n]/g, " ")}\n${authorName.replace(/[\r\n]/g, " ")}\n`;
  const parts = splitIntoDiscordMessages(prefix + body);

  try {
    for (const part of parts) {
      await targetChannel.send({
        content: part,
        allowedMentions: { parse: [] },
      });
    }
  } catch (error) {
    logger.error(
      {
        guildId: message.guild.id,
        sourceChannelId: message.channelId,
        destinationChannelId: destination.channelId,
        code: discordErrorCode(error),
      },
      "Message relay failed; original message was kept",
    );
    return;
  }

  try {
    await message.delete();
  } catch (error) {
    logger.error(
      {
        guildId: message.guild.id,
        channelId: message.channelId,
        code: discordErrorCode(error),
      },
      "Message was delivered but the original could not be deleted",
    );
  }
}

async function handleReactionRole(
  reaction: MessageReaction | PartialMessageReaction,
  user: { id: string; bot: boolean },
): Promise<void> {
  if (user.bot) return;

  const hydratedReaction: MessageReaction = reaction.partial
    ? await reaction.fetch()
    : reaction;
  if (hydratedReaction.message.partial) {
    await hydratedReaction.message.fetch();
  }

  const message = hydratedReaction.message;
  const guild = message.guild;
  const key = emojiKey(hydratedReaction);
  if (!guild || !key) return;

  const mapping = (await readBotStore()).reactionRoleMappings.find(
    (record) =>
      record.guildId === guild.id &&
      record.messageId === message.id &&
      record.emojiKey === key,
  );
  if (!mapping) return;

  try {
    const member = await guild.members.fetch(user.id);
    if (member.roles.cache.has(mapping.roleId)) return;
    const role = await guild.roles.fetch(mapping.roleId);
    if (!role) {
      logger.warn(
        {
          guildId: guild.id,
          messageId: message.id,
          roleId: mapping.roleId,
        },
        "Reaction role no longer exists",
      );
      return;
    }

    const botMember = guild.members.me ?? (await guild.members.fetchMe());
    if (
      !botMember.permissions.has(PermissionFlagsBits.ManageRoles) ||
      role.managed ||
      botMember.roles.highest.comparePositionTo(role) <= 0
    ) {
      logger.warn(
        { guildId: guild.id, roleId: role.id },
        "Could not assign reaction role because of permissions or role hierarchy",
      );
      return;
    }
    await member.roles.add(role, "Discord reaction role configuration");
  } catch (error) {
    logger.error(
      {
        guildId: guild.id,
        messageId: message.id,
        userId: user.id,
        code: discordErrorCode(error),
      },
      "Could not assign role from reaction",
    );
  }
}

function createNicknameModal(messageId: string): ModalBuilder {
  const nicknameInput = new TextInputBuilder()
    .setCustomId("nickname")
    .setLabel("치지직 닉네임을 입력해 주세요.")
    .setPlaceholder("닉네임")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(32);
  const row =
    new ActionRowBuilder<TextInputBuilder>().addComponents(nicknameInput);
  return new ModalBuilder()
    .setCustomId(`discord-nickname:submit:${messageId}`)
    .setTitle("✎ 닉네임 변경 ✎")
    .addComponents(row);
}

async function handleNicknameButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const guild = interaction.guild;
  const panelMessage = interaction.message;
  if (
    !guild ||
    !interaction.guildId ||
    !interaction.channelId ||
    !panelMessage
  ) {
    await replyPrivately(interaction, "서버에서 별명 변경 버튼을 이용해 주세요.");
    return;
  }

  await interaction.showModal(createNicknameModal(panelMessage.id));
}

async function handleNicknameSubmit(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const guild = interaction.guild;
  const messageId = interaction.customId.split(":").at(-1);
  if (
    !guild ||
    !interaction.guildId ||
    !interaction.channelId ||
    !messageId
  ) {
    await replyPrivately(interaction, "서버에서만 닉네임을 변경할 수 있습니다.");
    return;
  }

  const nickname = interaction.fields.getTextInputValue("nickname").trim();
  const nicknameLength = Array.from(nickname).length;
  if (nicknameLength < 1 || nicknameLength > 32) {
    await replyPrivately(
      interaction,
      "닉네임은 비워 둘 수 없고 1~32자여야 합니다.",
    );
    return;
  }

  try {
    const [member, botMember] = await Promise.all([
      guild.members.fetch(interaction.user.id),
      guild.members.me ? Promise.resolve(guild.members.me) : guild.members.fetchMe(),
    ]);
    if (member.id === guild.ownerId) {
      await replyPrivately(
        interaction,
        "서버 소유자의 별명은 봇이 변경할 수 없습니다.",
      );
      return;
    }
    if (!botMember.permissions.has(PermissionFlagsBits.ManageNicknames)) {
      await replyPrivately(
        interaction,
        "봇에 별명 관리(Manage Nicknames) 권한이 없습니다.",
      );
      return;
    }
    if (botMember.roles.highest.comparePositionTo(member.roles.highest) <= 0) {
      await replyPrivately(
        interaction,
        "봇의 역할이 회원의 최고 역할보다 위에 있어야 별명을 변경할 수 있습니다.",
      );
      return;
    }

    await member.setNickname(nickname, "User submitted their Chzzk nickname");
    await replyPrivately(
      interaction,
      `서버 별명을 \`${nickname}\`(으)로 변경했습니다.`,
    );
  } catch (error) {
    const code = discordErrorCode(error);
    logger.warn(
      {
        guildId: guild.id,
        userId: interaction.user.id,
        code,
      },
      "Could not update a member nickname",
    );
    if (code === 50013 || code === "50013") {
      await replyPrivately(
        interaction,
        "별명 변경 권한이 부족합니다. 봇의 Manage Nicknames 권한과 역할 순서를 확인해 주세요.",
      );
      return;
    }
    await replyPrivately(
      interaction,
      "별명을 변경하지 못했습니다. 입력값과 봇의 권한 및 역할 순서를 확인해 주세요.",
    );
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  logger.info(
    {
      botUserId: readyClient.user.id,
      guildCount: readyClient.guilds.cache.size,
    },
    "Discord bot is connected",
  );
  try {
    await readyClient.application.commands.set([]);
    logger.info("Cleared previously registered global slash commands");
  } catch (error) {
    logger.error(
      { code: discordErrorCode(error) },
      "Could not clear previously registered global slash commands",
    );
  }
  for (const guild of readyClient.guilds.cache.values()) {
    await registerCommandsForGuild(guild);
  }
  await refreshNicknamePanels().catch((error: unknown) => {
    logger.error(
      { code: discordErrorCode(error) },
      "Could not update saved nickname panels",
    );
  });
});

client.on(Events.GuildCreate, (guild) => {
  void registerCommandsForGuild(guild);
});

client.on(Events.MessageCreate, (message) => {
  void forwardMessage(message).catch((error: unknown) => {
    logger.error(
      {
        guildId: message.guildId,
        channelId: message.channelId,
        code: discordErrorCode(error),
      },
      "Unexpected error while processing a relay message",
    );
  });
});

client.on(Events.MessageReactionAdd, (reaction, user) => {
  void handleReactionRole(reaction, user).catch((error: unknown) => {
    logger.error(
      {
        userId: user.id,
        code: discordErrorCode(error),
      },
      "Unexpected error while handling a reaction role",
    );
  });
});

client.on(Events.InteractionCreate, (interaction) => {
  void (async () => {
    if (interaction.isChatInputCommand()) {
      await handleChatCommand(interaction);
      return;
    }
    if (
      interaction.isButton() &&
      interaction.customId === "discord-nickname:open"
    ) {
      await handleNicknameButton(interaction);
      return;
    }
    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith("discord-nickname:submit:")
    ) {
      await handleNicknameSubmit(interaction);
    }
  })().catch(async (error: unknown) => {
    logger.error(
      {
        interactionId: interaction.id,
        commandName:
          interaction.isChatInputCommand() ? interaction.commandName : undefined,
        code: discordErrorCode(error),
      },
      "Interaction failed",
    );
    if (interaction.isRepliable()) {
      await replyPrivately(
        interaction,
        "요청을 처리하지 못했습니다. 봇 권한과 서버 설정을 확인해 주세요.",
      ).catch(() => undefined);
    }
  });
});

client.on(Events.Error, (error) => {
  logger.error({ code: discordErrorCode(error) }, "Discord client error");
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Stopping Discord bot");
  client.destroy();
  await flushBotStore();
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

async function startBot(): Promise<void> {
  await loadBotStore();
  logger.info("Loaded local Discord bot settings");
  await client.login(botToken);
}

void startBot().catch((error: unknown) => {
  logger.error(
    { code: discordErrorCode(error) },
    "Could not start Discord bot. Check the local data file, token, and enabled gateway intents.",
  );
  process.exitCode = 1;
});
