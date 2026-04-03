const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ThumbnailBuilder,
    SectionBuilder,
    MessageFlags
} = require('discord.js');
const config = require('../../config.js');
const YouTube = require('../../src/YouTube.js');
const LanguageManager = require('../../src/LanguageManager');
const chalk = require('chalk');

module.exports = {
    name: "search",
    aliases: ["search", "بحث", "دور"],
    description: "Search and select music on YouTube",
    async execute(message, args, client) {
        const query = args.join(" ");
        const guildId = message.guild.id;
        const guild = message.guild;
        const member = message.member || await guild.members.fetch(message.author.id).catch(() => null);

        if (!query) {
            const errorMsg = "❌ Please provide a song name to search!";
            return message.reply({
                content: errorMsg,
                allowedMentions: { repliedUser: false }
            });
        }

        try {
            // Processing message
            const searchingMsg = "🔍 Searching...";
            const processingMessage = await message.reply({
                content: searchingMsg,
                allowedMentions: { repliedUser: false }
            });

            // Validation
            const validationResult = await this.validateRequest(message, member, guild);
            if (!validationResult.success) {
                return await processingMessage.edit({
                    content: validationResult.message
                });
            }

            // Search results
            const results = await YouTube.search(query, 15, guildId);

            if (!results || results.length === 0) {
                const noResultsMsg = await LanguageManager.getTranslation(guildId, 'commands.search.no_results');
                return await processingMessage.edit({
                    content: noResultsMsg
                });
            }

            // Show professional search menu
            await this.showSearchMenu(processingMessage, results, query, guildId, member.user.id);

        } catch (error) {
            console.error(chalk.red('Search custom command error:'), error);
            const errorMsg = await LanguageManager.getTranslation(guildId, 'commands.search.error_search');
            try {
                await message.reply({
                    content: errorMsg,
                    allowedMentions: { repliedUser: false }
                });
            } catch (e) { }
        }
    },

    async validateRequest(message, member, guild) {
        // Text channel permissions check
        const textChannelPermissions = message.channel.permissionsFor(guild.members.me);
        if (!textChannelPermissions.has(PermissionFlagsBits.SendMessages)) {
            return { success: false };
        }

        // Voice channel check
        if (!member.voice.channel) {
            const errorMsg = await LanguageManager.getTranslation(guild.id, 'commands.play.voice_channel_required');
            return { success: false, message: errorMsg };
        }

        // Permissions check
        const permissions = member.voice.channel.permissionsFor(guild.members.me);
        if (!permissions.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) {
            const errorMsg = await LanguageManager.getTranslation(guild.id, 'commands.play.no_permissions');
            return { success: false, message: errorMsg };
        }

        // Same channel check
        const botVoiceChannel = guild.members.me.voice.channel;
        if (botVoiceChannel && botVoiceChannel.id !== member.voice.channel.id) {
            const errorMsg = await LanguageManager.getTranslation(guild.id, 'commands.play.same_channel_required');
            return { success: false, message: errorMsg };
        }

        return { success: true };
    },

    async showSearchMenu(processingMessage, results, query, guildId, userId) {
        // Translations
        const searchTitleText = await LanguageManager.getTranslation(guildId, 'commands.search.title', { query });
        const selectPlaceholder = await LanguageManager.getTranslation(guildId, 'commands.search.select_description');
        const cancelButtonLabel = await LanguageManager.getTranslation(guildId, 'commands.search.button_cancel');
        const unknownTitle = await LanguageManager.getTranslation(guildId, 'commands.search.unknown_title');
        const unknownChannel = await LanguageManager.getTranslation(guildId, 'commands.search.unknown_channel');
        const unknownDuration = await LanguageManager.getTranslation(guildId, 'commands.search.unknown_duration');

        // Professional Header
        const headerText = new TextDisplayBuilder()
            .setContent(`**${searchTitleText}**`);

        const sep1 = new SeparatorBuilder()
            .setSpacing(SeparatorSpacingSize.Small)
            .setDivider(true);

        // Build list of results for display
        let resultsDescription = "";
        const maxDisplay = Math.min(results.length, 10);

        for (let i = 0; i < maxDisplay; i++) {
            const r = results[i];
            const duration = this.formatDuration(r.duration, unknownDuration);
            resultsDescription += `\`${i + 1}.\` **${r.title || unknownTitle}**\n-# 👤 ${r.artist || unknownChannel} • ⏱️ ${duration}\n\n`;
        }

        const resultsDisplay = new TextDisplayBuilder()
            .setContent(resultsDescription);

        // Container UI
        const container = new ContainerBuilder()
            .setAccentColor(parseInt((config.bot.embedColor || '#FF6B6B').replace('#', ''), 16))
            .addTextDisplayComponents(headerText)
            .addSeparatorComponents(sep1)
            .addTextDisplayComponents(resultsDisplay);

        // Select Menu
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('search_select')
            .setPlaceholder(selectPlaceholder)
            .setMaxValues(1);

        for (let i = 0; i < maxDisplay; i++) {
            const r = results[i];
            const duration = this.formatDuration(r.duration, unknownDuration);
            selectMenu.addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel(`${i + 1}. ${r.title || unknownTitle}`.substring(0, 100))
                    .setDescription(`${r.artist || unknownChannel} • ${duration}`.substring(0, 100))
                    .setValue(i.toString())
                    .setEmoji('🎵')
            );
        }

        const rowSelect = new ActionRowBuilder().addComponents(selectMenu);

        // Cancel Button
        const cancelButton = new ButtonBuilder()
            .setCustomId('search_cancel')
            .setLabel(cancelButtonLabel)
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌');

        const rowButtons = new ActionRowBuilder().addComponents(cancelButton);

        // Store results globally for the handler
        if (!global.searchResults) global.searchResults = new Map();
        global.searchResults.set(userId, {
            query: query,
            results: results,
            timestamp: Date.now()
        });

        // Auto clean-up after 5 minutes
        setTimeout(() => {
            if (global.searchResults.has(userId)) {
                const data = global.searchResults.get(userId);
                if (Date.now() - data.timestamp >= 5 * 60 * 1000) {
                    global.searchResults.delete(userId);
                }
            }
        }, 5 * 60 * 1000);

        await processingMessage.edit({
            content: null,
            flags: MessageFlags.IsComponentsV2,
            components: [container, rowSelect, rowButtons]
        });
    },

    formatDuration(seconds, unknownLabel = 'Unknown') {
        if (!seconds || seconds === 0) return unknownLabel;

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        } else {
            return `${minutes}:${secs.toString().padStart(2, '0')}`;
        }
    }
};
