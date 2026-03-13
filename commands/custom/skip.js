const { EmbedBuilder } = require("discord.js");
const LanguageManager = require("../../src/LanguageManager");
const config = require("../../config");
const chalk = require("chalk");

module.exports = {
    name: "skip",
    aliases: ["s", "تخطي", "بعده"],
    description: "Skips the current song and plays the next one in the queue.",
    async execute(message, args, client) {
        try {
            const guild = message.guild;
            const member = message.member;
            const player = client.players.get(guild.id);

            // 🛑 No player or no song playing
            if (!player || !player.currentTrack) {
                const msg = (await LanguageManager.getTranslation(guild.id, "buttonhandler.no_song_playing").catch(() => null)) || "❌ No song is currently playing!";
                return message.reply({
                    content: msg,
                    allowedMentions: { repliedUser: false }
                });
            }

            // 🛑 Check voice channel
            const botChannel = guild.members.me.voice.channel;
            if (!member.voice.channel || (botChannel && member.voice.channel.id !== botChannel.id)) {
                return message.reply({
                    content: (await LanguageManager.getTranslation(guild.id, "buttonhandler.same_channel_required").catch(() => null)) || "⚠️ You must be in the same voice channel as the bot to skip music.",
                    allowedMentions: { repliedUser: false }
                });
            }

            // 🛑 No more songs to skip to
            if (player.queue.length === 0) {
                const msg = (await LanguageManager.getTranslation(guild.id, "buttonhandler.no_songs_to_skip").catch(() => null)) || "❌ There are no more songs in the queue to skip to!";
                return message.reply({
                    content: msg,
                    allowedMentions: { repliedUser: false }
                });
            }

            const currentTrack = player.currentTrack;
            
            // ✅ Skip logic
            const skipped = player.skip();

            if (skipped) {
                // 🎨 Embed
                const embed = new EmbedBuilder()
                    .setTitle((await LanguageManager.getTranslation(guild.id, "buttonhandler.song_skipped_title").catch(() => null)) || "⏭️ Song Skipped")
                    .setDescription(`**[${currentTrack.title}](${currentTrack.url})** ${(await LanguageManager.getTranslation(guild.id, "buttonhandler.skipped").catch(() => null)) || "has been skipped!"}`)
                    .setColor(config.bot.embedColor || "#00FF00")
                    .setTimestamp()
                    .addFields({
                        name: (await LanguageManager.getTranslation(guild.id, "buttonhandler.skipped_by").catch(() => null)) || "Skipped by",
                        value: `${member}`,
                        inline: true,
                    });

                if (player.queue.length > 0) {
                    embed.addFields({
                        name: (await LanguageManager.getTranslation(guild.id, "buttonhandler.next_song").catch(() => null)) || "🔜 Next Song",
                        value: `[${player.queue[0].title}](${player.queue[0].url})`,
                        inline: false,
                    });
                    
                    embed.setFooter({
                        text: (await LanguageManager.getTranslation(guild.id, "buttonhandler.more_songs_in_queue", { count: player.queue.length }).catch(() => null)) || `There are ${player.queue.length} more song(s) in the queue.`,
                    });
                } else {
                    embed.setFooter({
                        text: (await LanguageManager.getTranslation(guild.id, "buttonhandler.no_more_songs").catch(() => null)) || "No more songs in the queue.",
                    });
                }

                if (currentTrack.thumbnail) embed.setThumbnail(currentTrack.thumbnail);

                await message.reply({
                    embeds: [embed],
                    allowedMentions: { repliedUser: false }
                });

                // 🔄 Update UI (Now Playing Embed)
                if (client.musicEmbedManager && player.currentTrack) {
                    await client.musicEmbedManager.updateNowPlayingEmbed(player);
                }

                console.log(chalk.greenBright(`⏭️ Song skipped in ${guild.name} by ${member.user.tag}`));
            } else {
                message.reply({
                    content: (await LanguageManager.getTranslation(guild.id, "buttonhandler.song_not_skipped").catch(() => null)) || "❌ Failed to skip the song!",
                    allowedMentions: { repliedUser: false }
                });
            }

        } catch (error) {
            console.error(chalk.red("❌ Error executing skip command:"), error);
            message.reply({
                content: "⚠️ An error occurred while trying to skip the song.",
                allowedMentions: { repliedUser: false }
            });
        }
    },
};
