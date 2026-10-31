import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

const administrator = PermissionFlagsBits.Administrator;

export const commandBuilders = [
  new SlashCommandBuilder()
    .setName("전달")
    .setDescription("현재 채널의 메시지 전달 설정을 관리합니다.")
    .setDefaultMemberPermissions(administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("입력")
        .setDescription("현재 채널을 메시지 입력 채널로 지정합니다.")
        .addStringOption((option) =>
          option
            .setName("태그")
            .setDescription("전달 그룹을 구분할 태그")
            .setRequired(true)
            .setMaxLength(100),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("관리자")
        .setDescription("현재 채널을 메시지 수신 채널로 지정합니다.")
        .addStringOption((option) =>
          option
            .setName("태그")
            .setDescription("전달 그룹을 구분할 태그")
            .setRequired(true)
            .setMaxLength(100),
        ),
    ),
  new SlashCommandBuilder()
    .setName("태그")
    .setDescription("현재 채널의 전달 태그를 변경하거나 삭제합니다.")
    .setDefaultMemberPermissions(administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("삭제")
        .setDescription("현재 채널의 전달 설정을 삭제합니다."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("변경")
        .setDescription("현재 채널의 전달 태그를 변경합니다.")
        .addStringOption((option) =>
          option
            .setName("태그")
            .setDescription("새 태그")
            .setRequired(true)
            .setMaxLength(100),
        ),
    ),
  new SlashCommandBuilder()
    .setName("역할")
    .setDescription("메시지 이모지 반응에 서버 역할을 연결합니다.")
    .setDefaultMemberPermissions(administrator)
    .addStringOption((option) =>
      option
        .setName("message_id")
        .setDescription("역할 반응을 등록할 메시지 ID")
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(32),
    )
    .addStringOption((option) =>
      option
        .setName("emoji")
        .setDescription("기본 이모지 또는 서버 커스텀 이모지")
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(128),
    )
    .addRoleOption((option) =>
      option
        .setName("role")
        .setDescription("이모지를 누른 사용자에게 지급할 역할")
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("별명")
    .setDescription("현재 채널에 별명 변경 안내 메시지를 게시합니다.")
    .setDefaultMemberPermissions(administrator),
];
