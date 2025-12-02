const { EmbedBuilder } = require("discord.js");
const LanguageManager = require("../../src/LanguageManager");
const config = require("../../config");
const chalk = require("chalk");

module.exports = {
    name: "stop",
    aliases: ["end", "halt", "وقف", "إيقاف"],
    description: "Stops playback and clears the queue, but stays connected.",
    async execute(message, args, client) {
        try {
            const guild = message.guild;
            const member = message.member;
            const player = client.players.get(guild.id);

            // 🛑 No player
            if (!player || !player.currentTrack) {
                const msg =
                    (await LanguageManager.getTranslation(
                        guild.id,
                        "buttonhandler.no_song_playing"
                    ).catch(() => null)) || "❌ No song is currently playing!";
                return message.reply(msg);
            }

            // 🛑 Check voice channel
            const botChannel = guild.members.me.voice.channel;
            if (!member.voice.channel || (botChannel && member.voice.channel.id !== botChannel.id)) {
                return message.reply(
                    (await LanguageManager.getTranslation(
                        guild.id,
                        "buttonhandler.same_channel_required"
                    ).catch(() => null)) || "⚠️ You must be in the same voice channel as the bot to stop music."
                );
            }

            const queueLength = player.queue.length;
            const currentTrack = player.currentTrack;

            // ✅ Just clear queue and stop playback (without leaving)
            player.queue = [];
            player.currentTrack = null;
            if (player.audioPlayer && player.audioPlayer.stop) {
                player.audioPlayer.stop(true); // stop current track but keep connection alive
            }

            // keep the connection active
            if (player.connection && player.connection.state.status !== "ready") {
                // don’t destroy the connection, just clear state
                console.log(chalk.yellow(`🎧 Keeping connection alive in ${guild.name}`));
            }

            // 🎨 Embed
            const embed = new EmbedBuilder()
                .setTitle(
                    (await LanguageManager.getTranslation(
                        guild.id,
                        "buttonhandler.music_stopped_title"
                    ).catch(() => null)) || "🛑 Music Stopped"
                )
                .setDescription(
                    `${currentTrack ? `**[${currentTrack.title}](${currentTrack.url})**` : "Music"} ${
                        (await LanguageManager.getTranslation(
                            guild.id,
                            "buttonhandler.stopped"
                        ).catch(() => null)) || "has been stopped!"
                    }`
                )
                .setColor(config.bot.embedColor || "#FF0000")
                .setTimestamp()
                .addFields({
                    name:
                        (await LanguageManager.getTranslation(
                            guild.id,
                            "buttonhandler.stopped_by"
                        ).catch(() => null)) || "Stopped by",
                    value: `${member}`,
                    inline: true,
                })
                .setFooter({
                    text:
                        (await LanguageManager.getTranslation(
                            guild.id,
                            "buttonhandler.songs_cleared",
                            { count: queueLength }
                        ).catch(() => null)) ||
                        `${queueLength} song(s) removed from the queue.`,
                });

            if (currentTrack?.thumbnail) embed.setThumbnail(currentTrack.thumbnail);

            await message.reply({ embeds: [embed] });

            // 🔄 Update UI (disable buttons or show stopped state)
            if (client.musicEmbedManager) {
                await client.musicEmbedManager.handlePlaybackEnd(player);
            }

            console.log(chalk.redBright(`🛑 Music stopped (staying in VC) in ${guild.name} by ${member.user.tag}`));
        } catch (error) {
            console.error(chalk.red("❌ Error executing stop command:"), error);
            message.reply("⚠️ An error occurred while trying to stop the music.");
        }
    },
};