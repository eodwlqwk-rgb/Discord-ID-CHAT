import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface RelayChannelRecord {
  channelId: string;
  guildId: string;
  tag: string;
  channelType: "input" | "admin";
  updatedAt: string;
}

export interface ReactionRoleRecord {
  guildId: string;
  messageId: string;
  channelId: string;
  emojiKey: string;
  emojiDisplay: string;
  roleId: string;
  updatedAt: string;
}

export interface NicknamePanelRecord {
  guildId: string;
  channelId: string;
  messageId: string;
  updatedAt: string;
}

export interface BotStoreData {
  version: 1;
  relayChannels: RelayChannelRecord[];
  reactionRoleMappings: ReactionRoleRecord[];
  nicknamePanels: NicknamePanelRecord[];
}

const storeDirectory = fileURLToPath(
  new URL("../../.discord-bot-data/", import.meta.url),
);
const storePath = path.join(storeDirectory, "store.json");

function emptyStore(): BotStoreData {
  return {
    version: 1,
    relayChannels: [],
    reactionRoleMappings: [],
    nicknamePanels: [],
  };
}

function isBotStoreData(value: unknown): value is BotStoreData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BotStoreData>;
  return (
    candidate.version === 1 &&
    Array.isArray(candidate.relayChannels) &&
    Array.isArray(candidate.reactionRoleMappings) &&
    Array.isArray(candidate.nicknamePanels)
  );
}

async function persist(snapshot: BotStoreData): Promise<void> {
  await mkdir(storeDirectory, { recursive: true, mode: 0o700 });
  const temporaryPath = `${storePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, storePath);
}

let store = emptyStore();
let loaded = false;
let queuedWrite: Promise<void> = Promise.resolve();

export async function loadBotStore(): Promise<void> {
  try {
    const content = await readFile(storePath, "utf8");
    const parsed: unknown = JSON.parse(content);
    if (!isBotStoreData(parsed)) {
      throw new Error(`Invalid bot data file format at ${storePath}`);
    }
    store = parsed;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      store = emptyStore();
      await persist(store);
    } else {
      throw error;
    }
  }
  loaded = true;
}

export async function readBotStore(): Promise<BotStoreData> {
  if (!loaded) throw new Error("Bot data file has not been loaded");
  await queuedWrite;
  return structuredClone(store);
}

export function updateBotStore<T>(
  update: (draft: BotStoreData) => T,
): Promise<T> {
  if (!loaded) throw new Error("Bot data file has not been loaded");

  const operation = queuedWrite.then(async () => {
    const draft = structuredClone(store);
    const result = update(draft);
    await persist(draft);
    store = draft;
    return result;
  });
  queuedWrite = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

export async function flushBotStore(): Promise<void> {
  await queuedWrite;
}
