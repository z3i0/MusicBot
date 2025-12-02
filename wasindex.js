const { Client, GatewayIntentBits, Collection, Events, ActivityType } = require('discord.js');
const { getVoiceConnection } = require('@discordjs/voice');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const config = require('./config');
const PlayerStateManager = require('./src/PlayerStateManager');
const MusicPlayer = require('./src/MusicPlayer');
const chalk = require('chalk');
const { joinVoiceChannel } = require("@discordjs/voice");

// require("./src/commandLoader"); // Load and deploy commands

// Clean up audio cache directory on startup
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

    console.log(chalk.cyan(`🔄 Found ${entries.length} saved session(s) to restore...`));

    for (const [guildId, state] of entries) {
        try {
            // Wait for guild to be available in cache
            let guild = client.guilds.cache.get(guildId);

            if (!guild) {
                // Try fetching with retry logic for sharding
                let retries = 3;
                while (!guild && retries > 0) {
                    try {
                        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
                        guild = await client.guilds.fetch(guildId).catch(() => null);
                        if (guild) break;
                    } catch (error) {
                        retries--;
                    }
                }
            }

            if (!guild) {
                console.log(chalk.yellow(`⚠️ Guild ${guildId} not found or not accessible, removing state...`));
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
                voiceChannel = await guild.channels.fetch(voiceChannelId).catch(() => null);
            }

            let textChannel = guild.channels.cache.get(textChannelId) || null;
            if (!textChannel) {
                textChannel = await guild.channels.fetch(textChannelId).catch(() => null);
            }

            const isVoiceValid = voiceChannel && typeof voiceChannel.isVoiceBased === 'function' && voiceChannel.isVoiceBased();
            const isTextValid = textChannel && typeof textChannel.isTextBased === 'function' && textChannel.isTextBased();

            if (!isVoiceValid || !isTextValid) {
                console.log(chalk.yellow(`⚠️ Invalid channels for guild ${guild.name}, removing state...`));
                await PlayerStateManager.removeState(guildId);
                continue;
            }

            const player = new MusicPlayer(guild, textChannel, voiceChannel);
            client.players.set(guildId, player);

            try {
                await player.restoreFromState(state);
                console.log(chalk.green(`✅ Successfully restored session for guild ${guild.name}`));
            } catch (error) {
                console.error(chalk.red(`❌ Failed to restore music session for guild ${guild.name} (${guildId}):`), error.message);
                client.players.delete(guildId);
                player.cleanup();
                await PlayerStateManager.removeState(guildId);
            }
        } catch (error) {
            console.error(chalk.red(`❌ Error during session restoration for guild ${guildId}:`), error.message);
            await PlayerStateManager.removeState(guildId);
        }
    }
}

// Don't cleanup audio cache yet - wait until after we check saved states
setTimeout(() => {
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildVoiceStates,
            GatewayIntentBits.GuildMembers,
        ]
        // ShardingManager automatically sets shard ID and count via environment variables
        // No need to specify shards/shardCount here - they are auto-injected
    });

    // Collections for commands and music players
    client.commands = new Collection();
    client.players = new Collection();

    const prefixCommandsPath = path.join(__dirname, 'commands/custom');
    client.prefixCommands = new Collection();

    if (fs.existsSync(prefixCommandsPath)) {
        const files = fs.readdirSync(prefixCommandsPath).filter(file => file.endsWith('.js'));

        for (const file of files) {
            const command = require(path.join(prefixCommandsPath, file));

            if (!command.name) continue;
            client.prefixCommands.set(command.name, command);

            if (command.aliases && Array.isArray(command.aliases)) {
                for (const alias of command.aliases) {
                    client.prefixCommands.set(alias, command);
                }
            }
            console.log(`✅ Loaded prefix command: ${command.name}${command.aliases ? ` (aliases: ${command.aliases.join(', ')})` : ''}`);
        }
    }

    client.on(Events.MessageCreate, async message => {
        if (message.author.bot) return;

        const COMMAND_CHANNEL_ID = process.env.COMMAND_ID;
        const prefix = "-";
        let content = message.content.trim();

        // ✅ Remove prefix if exists (but not required)
        if (content.startsWith(prefix)) {
            content = content.slice(prefix.length);
        }

        // ✅ Get current voice connection
        const connection = getVoiceConnection(message.guild.id);
        const botVoiceChannelId = connection?.joinConfig?.channelId;

        // ✅ Allow only in:
        // - the command channel
        // - or the voice channel the bot is active in
        if (message.channel.id !== COMMAND_CHANNEL_ID && message.channel.id !== botVoiceChannelId) {
            return; // ignore messages outside allowed rooms
        }

        // ✅ Split message into command and args
        const args = content.trim().split(/ +/);
        const commandName = args.shift()?.toLowerCase();
        if (!commandName) return;

        // ✅ Find command (supports aliases)
        const command =
            client.prefixCommands.get(commandName) ||
            client.prefixCommands.find(cmd => cmd.aliases && cmd.aliases.includes(commandName));

        if (!command) return;

        try {
            await command.execute(message, args, client);
        } catch (error) {
            console.error(chalk.red(`❌ Error in command ${commandName}:`), error);
            message.reply("⚠️ Something went wrong while executing that command.");
        }
    });

    // Initialize Music Embed Manager
    const MusicEmbedManager = require('./src/MusicEmbedManager');
    client.musicEmbedManager = new MusicEmbedManager(client);

    // Global reference for MusicPlayer'dan erişim
    if (!global.clients) global.clients = {};
    global.clients.musicEmbedManager = client.musicEmbedManager;

    // Load command files
    const loadCommands = () => {
        const commandsPath = path.join(__dirname, 'commands');

        // Create commands directory if it doesn't exist
        if (!fs.existsSync(commandsPath)) {
            fs.mkdirSync(commandsPath, { recursive: true });
        }

        try {
            const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

            for (const file of commandFiles) {
                const filePath = path.join(commandsPath, file);
                const command = require(filePath);

                if ('data' in command && 'execute' in command) {
                    client.commands.set(command.data.name, command);
                    console.log(chalk.green(`✓ Loaded command: ${command.data.name}`));
                } else {
                    console.log(chalk.yellow(`⚠ Warning: ${file} is missing required "data" or "execute" property.`));
                }
            }
        } catch (error) {
            console.log(chalk.yellow('⚠ No commands directory found, skipping command loading.'));
        }
    };

    // Load event handlers
    const loadEvents = () => {
        const eventsPath = path.join(__dirname, 'events');

        // Create events directory if it doesn't exist
        if (!fs.existsSync(eventsPath)) {
            fs.mkdirSync(eventsPath, { recursive: true });
        }

        try {
            const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

            for (const file of eventFiles) {
                const filePath = path.join(eventsPath, file);
                const event = require(filePath);

                if (event.once) {
                    client.once(event.name, (...args) => event.execute(...args));
                } else {
                    client.on(event.name, (...args) => event.execute(...args));
                }
                console.log(chalk.green(`✓ Loaded event: ${event.name}`));
            }
        } catch (error) {
            console.log(chalk.yellow('⚠ No events directory found, using default events.'));
        }
    };

    // Basic ready event
    client.once(Events.ClientReady, async () => {
        console.log(chalk.green(`✅ [SHARD ${client.shard?.ids[0] ?? 0}] ${client.user.tag} is online and ready!`));
        console.log(chalk.cyan(`🎵 [SHARD ${client.shard?.ids[0] ?? 0}] Music bot serving ${client.guilds.cache.size} servers on this shard!`));

        const AUTO_JOIN_GUILD_ID = process.env.GUILD_ID;
        const AUTO_JOIN_CHANNEL_ID = process.env.CHANNEL_ID;

        try {
            const guild = await client.guilds.fetch(AUTO_JOIN_GUILD_ID);
            const channel = await guild.channels.fetch(AUTO_JOIN_CHANNEL_ID);

            if (channel && channel.isVoiceBased()) {
                joinVoiceChannel({
                    channelId: channel.id,
                    guildId: guild.id,
                    adapterCreator: guild.voiceAdapterCreator,
                    selfDeaf: true,
                });
                console.log(chalk.magenta(`🔊 Auto-joined voice channel: ${channel.name} (${guild.name})`));
            } else {
                console.log(chalk.yellow("⚠️ Auto-join failed: Voice channel not found or invalid."));
            }
        } catch (err) {
            console.error(chalk.red("❌ Failed to auto-join voice channel on startup:"), err);
        }

        // Log total guild count across all shards (only if running with sharding)
        // Wait a bit to ensure all shards are ready before fetching
        if (client.shard) {
            setTimeout(() => {
                client.shard.fetchClientValues('guilds.cache.size')
                    .then(results => {
                        const totalGuilds = results.reduce((acc, guildCount) => acc + guildCount, 0);
                        console.log(chalk.magenta(`🌐 [SHARD ${client.shard.ids[0]}] Total servers across all shards: ${totalGuilds}`));
                    })
                    .catch(err => {
                        // Silently fail if shards are still spawning
                        if (!err.message.includes('still being spawned')) {
                            console.error(chalk.red('Error fetching total guild count:'), err);
                        }
                    });
            }, 10000); // Wait 10 seconds for other shards to be ready
        }

        // Set bot activity
        setInterval(() => client.user.setActivity({ name: `${config.bot.status}`, type: ActivityType.Listening }), 10000);

        // Don't restore here in sharded mode - wait for shard manager to broadcast
        // For non-sharded mode, restore immediately
        if (!client.shard) {
            console.log(chalk.cyan('⏳ Non-sharded mode: waiting for guilds to be fully cached...'));
            await new Promise(resolve => setTimeout(resolve, 5000));
            await client.restoreSessions();
        }
    });

    // Add restore function to client for shard manager to call
    client.restoreSessions = async function () {
        console.log(chalk.cyan(`[SHARD ${client.shard?.ids?.[0] ?? 'N/A'}] 🔄 Starting session restore...`));
        await restoreSavedPlayers(client);
        await cleanupAudioCache();
        console.log(chalk.green(`[SHARD ${client.shard?.ids?.[0] ?? 'N/A'}] ✅ Session restore complete`));
    };

    // Handle interactions (slash commands)
    client.on(Events.InteractionCreate, async interaction => {
        if (!interaction.isChatInputCommand()) return;

        const command = client.commands.get(interaction.commandName);

        if (!command) {
            console.error(chalk.red(`❌ No command matching ${interaction.commandName} was found.`));
            return;
        }

        try {
            await command.execute(interaction, client);
        } catch (error) {
            console.error(chalk.red(`❌ Error executing ${interaction.commandName}:`), error);

            const errorMessage = '❌ An error occurred while executing this command!';

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: errorMessage, ephemeral: true });
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        }
    });

    // Handle voice state updates for pause/resume and cleanup
    client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
        const guild = oldState.guild;
        const botId = guild.members.me?.id;
        const AUTO_JOIN_CHANNEL_ID = process.env.CHANNEL_ID;

                if (oldState.id === botId && newState.channelId && newState.channelId !== AUTO_JOIN_CHANNEL_ID) {
            console.log(chalk.yellow(`🔄 Bot was moved in ${guild.name}, moving back...`));

            setTimeout(async () => {
                try {
                    const connection = getVoiceConnection(guild.id);
                    if (connection) {
                        // connection.destroy();
                        await new Promise(resolve => setTimeout(resolve, 1500));
                    }

                    const targetChannel = await guild.channels.fetch(AUTO_JOIN_CHANNEL_ID).catch(() => null);
                    if (targetChannel && targetChannel.isVoiceBased()) {
                        joinVoiceChannel({
                            channelId: targetChannel.id,
                            guildId: guild.id,
                            adapterCreator: guild.voiceAdapterCreator,
                            selfDeaf: true,
                            selfMute: false,
                        });
                        console.log(chalk.green(`✅ Returned to original voice channel: ${targetChannel.name}`));
                    }
                } catch (err) {
                    console.error(chalk.red("❌ Failed to move back:"), err);
                }
            }, 5000);
        }

        if (oldState.id === botId && oldState.channelId && !newState.channelId) {
            console.log(chalk.red(`🔁 Bot was disconnected from ${guild.name}, rejoining...`));

            setTimeout(async () => {
                try {
                    const connection = getVoiceConnection(guild.id);
                    if (connection) {
                        // connection.destroy();
                        await new Promise(resolve => setTimeout(resolve, 1500));
                    }

                    const targetChannel = await guild.channels.fetch(AUTO_JOIN_CHANNEL_ID).catch(() => null);
                    if (targetChannel && targetChannel.isVoiceBased()) {
                        joinVoiceChannel({
                            channelId: targetChannel.id,
                            guildId: guild.id,
                            adapterCreator: guild.voiceAdapterCreator,
                            selfDeaf: true,
                            selfMute: false,
                        });
                        console.log(chalk.green(`✅ Rejoined voice channel: ${targetChannel.name}`));
                    } else {
                        console.log(chalk.yellow(`⚠️ Could not rejoin: target channel invalid or missing.`));
                    }
                } catch (err) {
                    console.error(chalk.red("❌ Error while trying to rejoin after disconnect:"), err);
                }
            }, 5000);
        }
    });


    // Handle process termination
    process.on('SIGINT', () => {

        // Disconnect from all voice channels
        client.players.forEach((player, guildId) => {
            player.stop();
            const connection = getVoiceConnection(guildId);
            if (connection) connection.destroy();
        });

        client.destroy();
        process.exit(0);
    });

    // Error handling
    process.on('unhandledRejection', (reason, promise) => {
        console.error(chalk.red('❌ Unhandled Rejection at:'), promise, chalk.red('reason:'), reason);

        // Discord API error handling
        if (reason && reason.code) {
            switch (reason.code) {
                case 10062: // Unknown interaction
                    console.log(chalk.yellow('ℹ️ Interaction has expired, safely ignoring...'));
                    return;
                case 40060: // Interaction already acknowledged
                    console.log(chalk.yellow('ℹ️ Interaction already acknowledged, safely ignoring...'));
                    return;
                case 50013: // Missing permissions
                    console.error(chalk.red('❌ Missing permissions for Discord action'));
                    return;
            }
        }

        // Voice connection errors
        if (reason && reason.message && reason.message.includes('IP discovery')) {
            // Clean up any voice connections
            client.players.forEach(player => {
                if (player && player.cleanup) {
                    player.cleanup();
                }
            });
            client.players.clear();
            return;
        }
    });

    process.on('uncaughtException', (error) => {
        console.error(chalk.red('❌ Uncaught Exception:'), error);

        // Don't exit on Discord API errors
        if (error.code === 10062 || error.code === 40060) {
            console.log(chalk.yellow('ℹ️ Discord interaction error handled, continuing...'));
            return;
        }

        // Handle fetch/network termination errors - don't crash
        if (error.message && (error.message.includes('terminated') ||
            error.message.includes('ECONNRESET') ||
            error.message.includes('ETIMEDOUT'))) {
            console.log(chalk.yellow('⚠️ Network error occurred, but bot continues running...'));
            return;
        }

        // For other critical errors, graceful shutdown
        console.log(chalk.red('🛑 Critical error occurred, shutting down...'));

        // Clean up all music players
        if (client && client.players) {
            client.players.forEach(player => {
                if (player && player.cleanup) {
                    player.cleanup();
                }
            });
            client.players.clear();
        }

        process.exit(1);
    });

    // Initialize bot
    const init = async () => {
        try {
            console.log(chalk.blue('🤖 Starting Discord Music Bot...'));

            // Load commands and events
            // loadCommands();
            loadEvents();

            // Graceful shutdown handler
            const gracefulShutdown = async (signal) => {
                // Save all active player states before shutdown
                const savePromises = [];
                for (const [guildId, player] of client.players) {
                    if (player && typeof player.persistState === 'function') {
                        // Use immediate=true to bypass debouncing
                        savePromises.push(player.persistState('shutdown', true).catch(err => {
                            console.error(chalk.red(`Failed to save state for guild ${guildId}:`), err);
                        }));
                    }
                }

                await Promise.all(savePromises);
                // Give time for saves to complete
                await new Promise(resolve => setTimeout(resolve, 1000));

                process.exit(0);
            };

            // Register shutdown handlers
            process.on('SIGINT', () => gracefulShutdown('SIGINT'));
            process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

            // Windows specific handlers
            if (process.platform === 'win32') {
                const readline = require('readline');
                if (process.stdin.isTTY) {
                    readline.createInterface({
                        input: process.stdin,
                        output: process.stdout
                    }).on('SIGINT', () => gracefulShutdown('SIGINT'));
                }
            }

            // Login to Discord
            await client.login(config.discord.token);

        } catch (error) {
            console.error(chalk.red('❌ Failed to start bot:'), error);
            process.exit(1);
        }
    };

    // Start the bot
    init();

    module.exports = client;
}, 5000);