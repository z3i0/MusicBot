const { Events } = require("discord.js");
const { joinVoiceChannel } = require("@discordjs/voice");
const chalk = require("chalk");

module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState) {

    const client = newState.client;

    const settings = client.config.settings || {};
    const targetGuildId = settings.auto_join_guild;
    const targetChannelId = settings.auto_join_channel;

    const isBot = newState.member?.id === client.user.id;

    if (isBot && targetGuildId && targetChannelId) {
      const guild = client.guilds.cache.get(targetGuildId);
      if (guild) {
        const targetChannel = guild.channels.cache.get(targetChannelId);
        if (targetChannel) {
          const leftChannel = oldState.channelId && !newState.channelId;
          const movedChannel = newState.channelId && newState.channelId !== targetChannelId;

          if (leftChannel || movedChannel) {
            console.log(chalk.yellow(`↪ Bot disconnected or moved. Rejoining ${targetChannelId}`));

            try {
              const connection = joinVoiceChannel({
                channelId: targetChannel.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
                selfDeaf: false,
              });

              // Prevent unhandled error event crashes
              connection.on('error', (err) => {
                 console.error(chalk.red("🚨 Voice connection error in voiceStateUpdate:"), err.message);
              });

              console.log(chalk.green("🔄 Bot rejoined the main channel."));
            } catch (err) {
              console.log(chalk.red("❌ Failed to rejoin channel:"), err.message);
            }
          }
        }
      }
    }

    // Handle music player listener checks (alone / not alone)
    const guildId = newState.guild?.id || oldState.guild?.id;
    if (!guildId) return;

    const player = client.players?.get(guildId);
    if (!player || !player.voiceChannel) return;

    const botChannelId = player.voiceChannel.id;
    if (oldState.channelId === botChannelId || newState.channelId === botChannelId) {
      const channel = player.guild?.channels?.cache?.get(botChannelId) || player.voiceChannel;
      const nonBots = channel?.members?.filter(m => !m.user.bot)?.size || 0;

      if (nonBots === 0) {
        if (player.currentTrack && !player.pauseReasons?.has('alone')) {
          player.startInactivityTimer('alone');
        }
      } else {
        if (player.pauseReasons?.has('alone')) {
          player.clearInactivityTimer(true);
        }
      }
    }
  },
};