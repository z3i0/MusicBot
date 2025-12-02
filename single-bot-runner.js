const {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  ActivityType,
} = require("discord.js");
const PlayerStateManager = require('./src/PlayerStateManager');
const MusicPlayer = require('./src/MusicPlayer');
const fsPromises = require('fs').promises;

const path = require("path");
const fs = require("fs");
const chalk = require("chalk");
const { joinVoiceChannel } = require("@discordjs/voice");

module.exports = async function runSingleBot(botRow) {
  const token = process.env[botRow.env_key];
  if (!token) {
    console.log(chalk.red(`❌ Missing token for bot: ${botRow.slug}`));
    return null;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates,
    ],
  });

  async function cleanupAudioCache() {
      const cacheDir = path.join(__dirname, 'audio_cache');
  
      try {
          if (fs.existsSync(cacheDir)) {
              const files = await fsPromises.readdir(cacheDir);
              const protectedFiles = PlayerStateManager.getProtectedCacheFiles();
  
              let deletedCount = 0;
              let skippedCount = 0;
  
              for (const file of files) {
                  const absolutePath = path.join(cacheDir, file);
  
                  if (protectedFiles.has(path.resolve(absolutePath))) {
                      skippedCount++;
                      continue;
                  }
  
                  try {
                      await fsPromises.unlink(absolutePath);
                      deletedCount++;
                  } catch (err) {
                      console.error(chalk.red(`❌ Failed to delete ${file}:`), err.message);
                  }
              }
          } else {
              fs.mkdirSync(cacheDir, { recursive: true });
          }
      } catch (error) {
          console.error(chalk.red('❌ Failed to cleanup audio cache:'), error.message);
      }
  }

  async function restoreSavedPlayers(client) {
    const savedStates = PlayerStateManager.getAllStates();
    const entries = Object.entries(savedStates || {});
    if (entries.length === 0) return;

    console.log(
      chalk.cyan(`🔄 Found ${entries.length} saved session(s) to restore...`)
    );

    for (const [guildId, state] of entries) {
      try {
        // Wait for guild to be available in cache
        let guild = client.guilds.cache.get(guildId);

        if (!guild) {
          // Try fetching with retry logic for sharding
          let retries = 3;
          while (!guild && retries > 0) {
            try {
              await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second
              guild = await client.guilds.fetch(guildId).catch(() => null);
              if (guild) break;
            } catch (error) {
              retries--;
            }
          }
        }

        if (!guild) {
          console.log(
            chalk.yellow(
              `⚠️ Guild ${guildId} not found or not accessible, removing state...`
            )
          );
          await PlayerStateManager.removeState(guildId);
          continue;
        }

        const voiceChannelId = state.voiceChannelId;
        const textChannelId = state.textChannelId;

        if (!voiceChannelId || !textChannelId) {
          await PlayerStateManager.removeState(guildId);
          continue;
        }

        let voiceChannel = guild.channels.cache.get(voiceChannelId) || null;
        if (!voiceChannel) {
          voiceChannel = await guild.channels
            .fetch(voiceChannelId)
            .catch(() => null);
        }

        let textChannel = guild.channels.cache.get(textChannelId) || null;
        if (!textChannel) {
          textChannel = await guild.channels
            .fetch(textChannelId)
            .catch(() => null);
        }

        const isVoiceValid =
          voiceChannel &&
          typeof voiceChannel.isVoiceBased === "function" &&
          voiceChannel.isVoiceBased();
        const isTextValid =
          textChannel &&
          typeof textChannel.isTextBased === "function" &&
          textChannel.isTextBased();

        if (!isVoiceValid || !isTextValid) {
          console.log(
            chalk.yellow(
              `⚠️ Invalid channels for guild ${guild.name}, removing state...`
            )
          );
          await PlayerStateManager.removeState(guildId);
          continue;
        }

        const player = new MusicPlayer(guild, textChannel, voiceChannel);
        client.players.set(guildId, player);

        try {
          await player.restoreFromState(state);
          console.log(
            chalk.green(
              `✅ Successfully restored session for guild ${guild.name}`
            )
          );
        } catch (error) {
          console.error(
            chalk.red(
              `❌ Failed to restore music session for guild ${guild.name} (${guildId}):`
            ),
            error.message
          );
          client.players.delete(guildId);
          player.cleanup();
          await PlayerStateManager.removeState(guildId);
        }
      } catch (error) {
        console.error(
          chalk.red(
            `❌ Error during session restoration for guild ${guildId}:`
          ),
          error.message
        );
        await PlayerStateManager.removeState(guildId);
      }
    }
  }

  client.restoreSessions = async () => {
    console.log(chalk.cyan("🔄 Starting session restore..."));
    await restoreSavedPlayers(client);
    await cleanupAudioCache();
    console.log(chalk.green("✅ Session restore complete"));
  };

  // attach DB configs
  client.config = botRow;
  client.prefix = botRow.prefix || "-";

  // guard: ensure channels array exists
  const channelsArr = Array.isArray(botRow.channels) ? botRow.channels : [];
  client.allowedChannels = new Set(
    channelsArr.map((c) => String(c.channel_id))
  );

  client.commands = new Collection();
  client.players = new Collection();

  // Load prefix commands (same as before)
  const prefixCommandsPath = path.join(__dirname, "commands/custom");
  if (fs.existsSync(prefixCommandsPath)) {
    const files = fs
      .readdirSync(prefixCommandsPath)
      .filter((f) => f.endsWith(".js"));
    for (const file of files) {
      const cmd = require(path.join(prefixCommandsPath, file));
      if (!cmd.name) continue;
      client.commands.set(cmd.name, cmd);
    }
  }

  // Load event handlers (kept your implementation)
  const loadEvents = () => {
    const eventsPath = path.join(__dirname, "events");
    if (!fs.existsSync(eventsPath)) {
      fs.mkdirSync(eventsPath, { recursive: true });
    }

    try {
      const eventFiles = fs
        .readdirSync(eventsPath)
        .filter((file) => file.endsWith(".js"));

      for (const file of eventFiles) {
        const filePath = path.join(eventsPath, file);
        const event = require(filePath);

        if (event.once) {
          client.once(event.name, (...args) => event.execute(...args));
        } else {
          client.on(event.name, (...args) => event.execute(...args));
        }
      }
      console.log(chalk.green("✓ All event handlers loaded."));
    } catch (error) {
      console.log(
        chalk.yellow("⚠ No events directory found, using default events.")
      );
    }

    try {
      client.prefixCommands = new Collection();
      if (fs.existsSync(prefixCommandsPath)) {
        const files = fs
          .readdirSync(prefixCommandsPath)
          .filter((file) => file.endsWith(".js"));

        for (const file of files) {
          const command = require(path.join(prefixCommandsPath, file));
          if (!command.name) continue;
          client.prefixCommands.set(command.name, command);

          if (command.aliases && Array.isArray(command.aliases)) {
            for (const alias of command.aliases) {
              client.prefixCommands.set(alias, command);
            }
          }
          console.log(
            `✅ Loaded prefix command: ${command.name}${
              command.aliases ? ` (aliases: ${command.aliases.join(", ")})` : ""
            }`
          );
        }
      }
    } catch (error) {
      console.log(chalk.red("❌ Error loading commands handlers:"), error);
    }
  };

  loadEvents();

  // Handle prefix and alias messages
  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    // channel filtering — if allowedChannels is empty, allow all (optionally change)
    if (
      client.allowedChannels.size > 0 &&
      !client.allowedChannels.has(message.channel.id)
    )
      return;

    const content = message.content.trim();

    // PREFIX COMMANDS
    if (content.startsWith(client.prefix)) {
      const args = content.slice(client.prefix.length).trim().split(/\s+/);
      const commandName = args.shift()?.toLowerCase();
      if (!commandName) return;

      const command =
        client.commands.get(commandName) ||
        [...client.commands.values()].find((cmd) =>
          cmd.aliases?.includes(commandName)
        );

      if (!command) return;

      try {
        await command.execute(message, args, client);
      } catch (err) {
        console.error(err);
        message.reply("⚠️ Error executing command.");
      }

      return;
    }

    // NON-PREFIX ALIASES
    const args = content.split(/\s+/);
    const rawName = args.shift()?.toLowerCase();
    const command = [...client.commands.values()].find((cmd) =>
      cmd.aliases?.includes(rawName)
    );
    if (!command) return;

    try {
      await command.execute(message, args, client);
    } catch (err) {
      console.error(err);
      message.reply("⚠️ Error executing command.");
    }
  });

  // READY event — use Events.ClientReady (this is the fix)
  client.once(Events.ClientReady, async () => {
    console.log(
      chalk.green(`🤖 ${client.user.tag} online (bot: ${client.config.slug})`)
    );

    // Add restore function to client for shard manager to call
    await client.restoreSessions();

    // auto join if settings provided (expect IDs as strings)
    const settings = botRow.settings || {};
    if (settings.auto_join_guild && settings.auto_join_channel) {
      try {
        // fetch guild and channel
        const guild = await client.guilds.fetch(
          String(settings.auto_join_guild)
        );
        const channel = await guild.channels.fetch(
          String(settings.auto_join_channel)
        );

        if (!channel) throw new Error("Target channel not found.");

        // robustly check for voice-capable channel
        const isVoice =
          typeof channel.isVoiceBased === "function"
            ? channel.isVoiceBased()
            : ["GUILD_VOICE", "GUILD_STAGE_VOICE"].includes(channel.type);

        if (isVoice) {
          joinVoiceChannel({
            channelId: channel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: true,
          });
          console.log(chalk.green("↪ Joined voice channel for auto-join."));
        } else {
          console.log(chalk.yellow("⚠ Target channel is not voice-based."));
        }
      } catch (e) {
        console.log(chalk.red("❌ Auto join failed:"), e.message);
      }
    }

    // activity
    try {
      client.user.setActivity({
        name: `${botRow.name} Music`,
        type: ActivityType.Listening,
      });
    } catch (e) {
      console.log(chalk.yellow("⚠ Unable to set activity:"), e.message);
    }
  });

  // attempt login and handle possible login errors
  try {
    await client.login(token);
  } catch (loginErr) {
    console.log(
      chalk.red(`❌ Failed to login bot ${botRow.slug}:`),
      loginErr.message
    );
    return null;
  }

  return client;
};
