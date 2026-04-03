const {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  ActivityType,
} = require("discord.js");
const PlayerStateManager = require("./src/PlayerStateManager");
const MusicPlayer = require("./src/MusicPlayer");
const fsPromises = require("fs").promises;

const path = require("path");
const fs = require("fs");
const chalk = require("chalk");
const { joinVoiceChannel, VoiceConnectionStatus } = require("@discordjs/voice");

// Handle global errors to prevent the process from exiting
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error, origin) => {
  console.error(`Caught exception: ${error}\n` + `Exception origin: ${origin}`);

  // Specific Discord API error handling (Unknown interaction, Interaction already acknowledged)
  if (error.code === 10062 || error.code === 40060) {
    console.log(chalk?.yellow ? chalk.yellow('ℹ️ Discord interaction error handled, continuing...') : 'ℹ️ Discord interaction error handled, continuing...');
    return;
  }
});


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
    const cacheDir = path.join(__dirname, "audio_cache");

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
            console.error(
              chalk.red(`❌ Failed to delete ${file}:`),
              err.message
            );
          }
        }
      } else {
        fs.mkdirSync(cacheDir, { recursive: true });
      }
    } catch (error) {
      console.error(
        chalk.red("❌ Failed to cleanup audio cache:"),
        error.message
      );
    }
  }

  async function restoreSavedPlayers(client) {
    const savedStates = PlayerStateManager.getAllStates(client.config.slug);
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
          await PlayerStateManager.removeState(client.config.slug, guildId);
          continue;
        }

        const voiceChannelId = state.voiceChannelId;
        const textChannelId = state.textChannelId;

        if (!voiceChannelId || !textChannelId) {
          await PlayerStateManager.removeState(client.config.slug, guildId);
          continue;
        }

        // Check for active session data before restoring (skip if it's only saved settings)
        const hasSessionData = state.currentTrack || (Array.isArray(state.queue) && state.queue.length > 0);
        const sessionAgeMs = Date.now() - (state.updatedAt || 0);
        const MAX_SESSION_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours

        if (!hasSessionData || sessionAgeMs > MAX_SESSION_AGE_MS) {
          if (hasSessionData && sessionAgeMs > MAX_SESSION_AGE_MS) {
            console.log(chalk.yellow(`⏳ Skipping expired session for guild ${guildId} (last updated ${Math.floor(sessionAgeMs / 3600000)}h ago)`));
            await PlayerStateManager.removeState(client.config.slug, guildId);
          }
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
          await PlayerStateManager.removeState(client.config.slug, guildId);
          continue;
        }

        const player = new MusicPlayer(guild, textChannel, voiceChannel, client.config.slug);
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
          await PlayerStateManager.removeState(client.config.slug, guildId);
        }
      } catch (error) {
        console.error(
          chalk.red(
            `❌ Error during session restoration for guild ${guildId}:`
          ),
          error.message
        );
        await PlayerStateManager.removeState(client.config.slug, guildId);
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
  const MusicEmbedManager = require("./src/MusicEmbedManager");
  client.musicEmbedManager = new MusicEmbedManager(client);

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
            `✅ Loaded prefix command: ${command.name}${command.aliases ? ` (aliases: ${command.aliases.join(", ")})` : ""
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

    let content = message.content.trim();

    // shorthand volume: v10 -> v 10, v+10 -> v +10
    const prefixEscaped = (client.prefix || "-").replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const vMatch = content.match(new RegExp(`^(${prefixEscaped})?v([+-]?\\d+)$`, 'i'));
    if (vMatch) {
      content = (vMatch[1] || "") + "v " + vMatch[2];
    }

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

      // --- Multi-Bot Orchestration Logic ---
      const isPlayCommand = ["play", "p", "شغل", "ش"].includes(commandName);
      const isControlCommand = ["stop", "skip", "pause", "resume", "leave", "volume", "v"].includes(commandName);
      const guildId = message.guild.id;
      const player = client.players.get(guildId);

      if (isPlayCommand) {
        // 1. If I'm already playing music, I ignore the play command (let another idle bot take it)
        if (player && player.currentTrack) return;

        // 2. I'm idle. Check if there are other bots with LOWER IDs that are also idle in this guild.
        // We use playerState.json as a shared cache for bot statuses.
        try {
          const db = PlayerStateManager.readDatabase();
          const botsInChannel = [];

          // Find all bots that have been active in this guild recently
          if (db.bots) {
            for (const [botId, botData] of Object.entries(db.bots)) {
              if (botData.players && botData.players[guildId]) {
                botsInChannel.push({ id: botId, data: botData.players[guildId] });
              }
            }
          }

          // Sort by ID (Priority)
          // Note: client.config.id is our ID
          const myId = String(client.config.id);
          const idleLowerIdBots = botsInChannel.filter(b => {
            const bId = String(b.id);
            // Is this bot idle? (no currentTrack)
            const isIdle = !b.data.currentTrack;
            return isIdle && bId < myId;
          });

          if (idleLowerIdBots.length > 0) {
            // There's a higher priority bot available, I'll stay silent.
            return;
          }
        } catch (e) {
          console.error("Orchestration check failed:", e.message);
        }
      } else if (isControlCommand) {
        // For control commands, only respond if I'm the one playing or I'm in the user's voice channel
        const memberVoiceChannelId = message.member?.voice?.channelId;
        const botVoiceChannelId = player?.voiceChannel?.id;

        if (!player || !player.currentTrack) return; // I'm not playing anything

        // If I'm in a different voice channel than the user, I shouldn't respond to their skip/stop
        if (memberVoiceChannelId && botVoiceChannelId && memberVoiceChannelId !== botVoiceChannelId) {
          return;
        }
      }
      // --- End Orchestration ---

      try {
        await command.execute(message, args, client);
      } catch (err) {
        console.error(err);
        try {
          await message.reply("⚠️ Error executing command.");
        } catch (replyErr) { }
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

    // --- Multi-Bot Orchestration Logic (for Aliases) ---
    const guildId = message.guild.id;
    const player = client.players.get(guildId);
    const isPlayCommand = ["play", "p", "شغل", "ش"].includes(rawName);
    const isControlCommand = ["stop", "skip", "pause", "resume", "leave", "volume", "v"].includes(rawName);

    if (isPlayCommand) {
      if (player && player.currentTrack) return;
      try {
        const db = PlayerStateManager.readDatabase();
        const botsInChannel = [];
        if (db.bots) {
          for (const [botId, botData] of Object.entries(db.bots)) {
            if (botData.players && botData.players[guildId]) {
              botsInChannel.push({ id: botId, data: botData.players[guildId] });
            }
          }
        }
        const myId = String(client.config.id);
        const idleLowerIdBots = botsInChannel.filter(b => {
          const bId = String(b.id);
          return !b.data.currentTrack && bId < myId;
        });
        if (idleLowerIdBots.length > 0) return;
      } catch (e) { }
    } else if (isControlCommand) {
      const memberVoiceChannelId = message.member?.voice?.channelId;
      const botVoiceChannelId = player?.voiceChannel?.id;
      if (!player || !player.currentTrack) return;
      if (memberVoiceChannelId && botVoiceChannelId && memberVoiceChannelId !== botVoiceChannelId) return;
    }
    // --- End Orchestration ---

    try {
      await command.execute(message, args, client);
    } catch (err) {
      console.error(err);
      try {
        await message.reply("⚠️ Error executing command.");
      } catch (replyErr) { }
    }
  });

  // Global error handlers to prevent process crashes
  client.on('error', (error) => {
    console.error(chalk.red(`❌ Client error for ${client.config.slug}:`), error);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error(chalk.red('❌ Unhandled Rejection at:'), promise, 'reason:', reason);
  });

  process.on('uncaughtException', (error) => {
    console.error(chalk.red('❌ Uncaught Exception:'), error);
  });

  // READY event — use Events.ClientReady (this is the fix)
  client.once(Events.ClientReady, async () => {
    console.log(
      chalk.green(`🤖 ${client.user.tag} online (bot: ${client.config.slug})`)
    );

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
          const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: settings.self_deaf ?? true,
            selfMute: settings.self_mute ?? false,
          });

          // Handle connection errors to prevent crash
          connection.on('error', (error) => {
            console.error(chalk.red("🚨 Voice connection error in auto-join:"), error.message);
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

    // Add restore function to client for shard manager to call
    await client.restoreSessions();
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
