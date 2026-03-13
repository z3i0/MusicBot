const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { JsonDB } = require('node-json-db');
const { Config } = require('node-json-db/dist/lib/JsonDBConfig');
const fs = require('fs');
const path = require('path');
const LanguageManager = require('../../src/LanguageManager');

// Initialize JSON database
const db = new JsonDB(
  new Config(path.join(__dirname, '../../database/languages'), true, true, '/')
);

module.exports = {
    name: 'language',
    aliases: ["لغه", "لغة"],
    description: 'Changes server language',
    usage: '!language',
    async execute(message, args, client) {
        try {
            // Check for MANAGE_GUILD permission
            if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                const noPermissionTitle = await LanguageManager.getTranslation(message.guild.id, 'commands.language.errortitle');
                const noPermissionDesc = await LanguageManager.getTranslation(message.guild.id, 'commands.language.permission_required');

                const errorEmbed = new EmbedBuilder()
                    .setTitle(noPermissionTitle)
                    .setDescription(noPermissionDesc)
                    .setColor('#ff0000')
                    .setTimestamp();

                return await message.reply({ embeds: [errorEmbed] });
            }

            const guildId = message.guild.id;

            // Get current language
            let currentLang = 'en'; // Default
            try {
                currentLang = await db.getData(`/servers/${guildId}/language`);
            } catch (error) {
                // Not set
                console.log('Language not set for this server, using default.', error);
            }

            // Load available languages
            const languagesPath = path.join(__dirname, '..', '..', 'languages');
            const languageFiles = fs.readdirSync(languagesPath).filter(file => file.endsWith('.json'));

            const languages = [];
            for (const file of languageFiles) {
                const langData = JSON.parse(fs.readFileSync(path.join(languagesPath, file), 'utf8'));
                languages.push({
                    code: langData.language.code,
                    name: langData.language.name,
                    flag: langData.language.flag
                });
            }

            // Current language data
            const currentLangData = languages.find(lang => lang.code === currentLang);
            const currentLangFile = JSON.parse(fs.readFileSync(path.join(languagesPath, `${currentLang}.json`), 'utf8'));

            // Create embed
            const embed = new EmbedBuilder()
                .setTitle(currentLangFile.commands.language.title)
                .setDescription(currentLangFile.commands.language.select)
                .setColor('#0099ff')
                .setTimestamp()
                .addFields({
                    name: currentLangFile.commands.language.current,
                    value: `${currentLangData.flag} ${currentLangData.name}`,
                    inline: true
                });

            // Create language buttons
            const buttons = [];
            const rows = [];

            for (let i = 0; i < languages.length; i++) {
                const lang = languages[i];
                const button = new ButtonBuilder()
                    .setCustomId(`language_${lang.code}`)
                    .setLabel(lang.name)
                    .setEmoji(lang.flag)
                    .setStyle(lang.code === currentLang ? ButtonStyle.Primary : ButtonStyle.Secondary);

                buttons.push(button);

                // Max 5 buttons per row
                if (buttons.length === 5 || i === languages.length - 1) {
                    const row = new ActionRowBuilder().addComponents(...buttons);
                    rows.push(row);
                    buttons.length = 0;
                }
            }

            await message.reply({
                embeds: [embed],
                components: rows
            });

        } catch (error) {
            console.error(error);
            let errorDes = await LanguageManager.getTranslation(message.guild.id, 'commands.language.error2');
            let errorTitle = await LanguageManager.getTranslation(message.guild.id, 'commands.language.errortitle');

            const errorEmbed = new EmbedBuilder()
                .setTitle(errorTitle)
                .setDescription(errorDes)
                .setColor('#ff0000')
                .setTimestamp();

            await message.reply({ embeds: [errorEmbed] });
        }
    },

    // Handle language buttons
    async handleLanguageButton(interaction) {
        try {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                const noPermissionTitle = await LanguageManager.getTranslation(interaction.guild.id, 'commands.language.errortitle');
                const noPermissionDesc = '❌ Bu butonu kullanmak için **Sunucuyu Yönet** yetkisine sahip olmalısın!';

                const errorEmbed = new EmbedBuilder()
                    .setTitle(noPermissionTitle)
                    .setDescription(noPermissionDesc)
                    .setColor('#ff0000')
                    .setTimestamp();

                return await interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
            }

            const guildId = interaction.guild.id;
            const selectedLang = interaction.customId.replace('language_', '');

            // ✅ تحقق أن اللغة فعلاً مدعومة
            if (!LanguageManager.isLanguageSupported(selectedLang)) {
                throw new Error(`Invalid language selected: ${selectedLang}`);
            }

            // ✅ حاول حفظ اللغة
            const success = await LanguageManager.setServerLanguage(guildId, selectedLang).catch(err => {
                console.error('DB Write Error:', err);
                return false;
            });

            if (!success) {
                console.error(`❌ Failed to save language for guild ${guildId}`);
                throw new Error('Failed to save language preference');
            }

            // ✅ احصل على بيانات اللغة المختارة
            const selectedLangData = LanguageManager.getLanguageData(selectedLang);

            // ✅ اطبع في الكونسول لتتأكد من أنه فعلاً اتسجل
            console.log(`🌐 ${guildId} language set to ${selectedLangData.language.name} (${selectedLang})`);

            // ✅ ترجمة رسالة النجاح
            const successTitle = await LanguageManager.getTranslation(guildId, 'commands.language.changed');
            const successDescription = await LanguageManager.getTranslation(guildId, 'commands.language.changed_desc', {
                language: `${selectedLangData.language.flag} ${selectedLangData.language.name}`
            });

            const successEmbed = new EmbedBuilder()
                .setTitle(successTitle)
                .setDescription(successDescription)
                .setColor('#00ff00')
                .setTimestamp();

            await interaction.update({
                embeds: [successEmbed],
                components: []
            });

        } catch (error) {
            console.error('⚠️ Error in handleLanguageButton:', error);

            const errorTitle = await LanguageManager.getTranslation(interaction.guild.id, 'commands.language.errortitle');
            const errorDes = await LanguageManager.getTranslation(interaction.guild.id, 'commands.language.error');

            const errorEmbed = new EmbedBuilder()
                .setTitle(errorTitle)
                .setDescription(errorDes)
                .setColor('#ff0000')
                .setTimestamp();

            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ embeds: [errorEmbed] });
            } else {
                try {
                    await interaction.update({ embeds: [errorEmbed], components: [] });
                } catch {
                    await interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
                }
            }
        }
    }

};