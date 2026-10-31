# Discord 메시지 전달 봇

Discord 서버에서 메시지 전달, 이모지 반응 역할 지급, 셀프 서버 별명 변경을 제공하는 봇입니다.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/scripts run discord:bot` — run the Discord bot
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- The Discord bot only needs `DISCORD_BOT_TOKEN`, read from the repository-root `.env` file or the process environment.
- The bot stores relay, reaction-role, and nickname-panel settings in `.discord-bot-data/store.json`; no database is needed to run the bot.
- `DATABASE_URL` is still used by the separate API server, not by the Discord bot.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- API DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

- `/전달 입력` and `/전달 관리자` pair text channels by tag; `/태그 삭제` and `/태그 변경` only affect the current channel.
- Messages are relayed to the matching administrator channel and deleted from the source only after delivery succeeds.
- `/역할` adds a persistent reaction-to-role mapping; removing a reaction never removes the role.
- `/별명` posts or refreshes a persistent panel for members to change only their own server nickname.
- Bot configuration persists locally in `.discord-bot-data/store.json`; back up this file when moving the bot to another server.

## Discord setup

- Invite the bot with the `bot` and `applications.commands` scopes.
- Enable the Server Members and Message Content privileged gateway intents in the Discord Developer Portal.
- Grant View Channel, Send Messages, Read Message History, Add Reactions, Manage Messages, Manage Roles, and Manage Nicknames as needed.
- Keep the bot's highest role above every role it assigns and above members whose nicknames it changes.
- `/역할` must be run in the same channel as the target message because Discord message lookup requires both channel ID and message ID.
- `/별명` uses Discord's built-in modal submit control; its label is controlled by the user's Discord client language.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
