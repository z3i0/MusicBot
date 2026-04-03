const {
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MessageFlags
} = require("discord.js");
const LanguageManager = require("../../src/LanguageManager");
const config = require("../../config");

module.exports = {
    name: "volume",
    aliases: ["vol", "v", "صوت"],
    description: "Adjust or set the music volume",
    async execute(message, args, client) {
        const guildId = message.guild.id;
        const player = client.players.get(guildId);

        if (!player) {
            // return message.reply({
            //     content: await LanguageManager.getTranslation(guildId, "buttonhandler.no_music_playing"),
            //     allowedMentions: { repliedUser: false }
            // });
            return;
        }

        if (!message.member.voice.channel || message.member.voice.channel.id !== player.voiceChannel.id) {
            // return message.reply({
            //     content: await LanguageManager.getTranslation(guildId, "buttonhandler.same_channel_required"),
            //     allowedMentions: { repliedUser: false }
            // });
            return;
        }

        // View current volume
        if (args.length === 0) {
            return message.reply({
                content: `🔊 **${player.volume}%**  ${buildVolumeBar(player.volume)}`,
                allowedMentions: { repliedUser: false }
            });
        }

        // Calculate new volume
        let newVolume;
        const input = args[0];
        if (input.startsWith("+")) newVolume = player.volume + (parseInt(input.slice(1)) || 10);
        else if (input.startsWith("-")) newVolume = player.volume - (parseInt(input.slice(1)) || 10);
        else newVolume = parseInt(input);

        if (isNaN(newVolume)) {
            return message.reply({
                content: await LanguageManager.getTranslation(guildId, "modalhandler.invalid_volume"),
                allowedMentions: { repliedUser: false }
            });
        }

        newVolume = Math.max(0, Math.min(100, newVolume));
        player.setVolume(newVolume);

        // Components V2
        // const accentColor = parseInt((config.bot.embedColor || '#2B2D31').replace('#', ''), 16);
        const bar = buildVolumeBar(newVolume);
        const volumeIcon = newVolume === 0 ? '🔇' : newVolume < 40 ? '🔈' : newVolume < 75 ? '🔉' : '🔊';

        const container = new ContainerBuilder()
            // .setAccentColor(accentColor)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`${volumeIcon}  **Volume Updated**`)
            )
            .addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### ${bar}  \`${newVolume}%\`\n` +
                    `-# Set by ${message.author}`
                )
            );


        // let emoji;

        // if (newVolume === 0) emoji = '🔇';
        // else if (newVolume < 40) emoji = '🔈';
        // else if (newVolume < 80) emoji = '🔉';
        // else emoji = '🔊';

        await message.react('✅');
        //  await message.reply({
        //    flags: MessageFlags.IsComponentsV2,
        //    components: [container],
        //     allowedMentions: { repliedUser: false }
        //  });

        if (client.musicEmbedManager) {
            client.musicEmbedManager.updateNowPlayingEmbed(player);
        }
    },
};

function buildVolumeBar(volume) {
    const filled = Math.round(volume / 10);
    const empty = 10 - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
}
