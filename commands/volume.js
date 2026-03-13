const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const LanguageManager = require('../src/LanguageManager');
const config = require('../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('volume')
        .setDescription('Adjust the music volume')
        .addIntegerOption(option =>
            option.setName('level')
                .setDescription('Volume level (0-100)')
                .setRequired(false)
                .setMinValue(0)
                .setMaxValue(100)
        ),

    async execute(interaction, client) {
        const guildId = interaction.guild.id;
        const player = client.players.get(guildId);

        if (!player) {
            return interaction.reply({
                content: await LanguageManager.getTranslation(guildId, 'buttonhandler.no_music_playing'),
                flags: [MessageFlags.Ephemeral]
            });
        }

        if (!interaction.member.voice.channel || interaction.member.voice.channel.id !== player.voiceChannel.id) {
            return interaction.reply({
                content: await LanguageManager.getTranslation(guildId, 'buttonhandler.same_channel_required'),
                flags: [MessageFlags.Ephemeral]
            });
        }

        const newVolume = interaction.options.getInteger('level');

        if (newVolume === null) {
            return interaction.reply({
                content: `🔊 ${await LanguageManager.getTranslation(guildId, 'nowplaying.volume', { volume: player.volume })}`,
                flags: [MessageFlags.Ephemeral]
            });
        }

        player.setVolume(newVolume);

        const embed = new EmbedBuilder()
            .setColor(config.bot.embedColor || 'Aqua')
            .setTitle(await LanguageManager.getTranslation(guildId, 'modalhandler.volume_changed_title'))
            .setDescription(await LanguageManager.getTranslation(guildId, 'modalhandler.volume_changed_desc', { volume: newVolume }))
            .addFields(
                { name: await LanguageManager.getTranslation(guildId, 'modalhandler.set_by'), value: `${interaction.user}`, inline: true },
                { name: await LanguageManager.getTranslation(guildId, 'modalhandler.level'), value: `\`${newVolume}%\``, inline: true }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });

        if (client.musicEmbedManager) {
            client.musicEmbedManager.updateNowPlayingEmbed(player);
        }
    }
};
