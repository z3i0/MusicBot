const {
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ThumbnailBuilder,
    SectionBuilder
} = require("discord.js");
const config = require("../../config.js");

module.exports = {
    name: "help",
    aliases: ["help", "مساعدة", "اوامر", "أوامر"],
    description: "عرض قائمة الأوامر المخصصة بتنسيق احترافي",
    async execute(message, args, client) {
        const prefix = client.prefix || "-";

        // 1. Header Section (Title + Bot Icon)
        const headerText = new TextDisplayBuilder()
            .setContent(
                `# 🎵 قائمة الأوامر المخصصة\n` +
                `أهلاً بك **${message.author.username}**! إليك قائمة بجميع الأوامر المتاحة في نسخة الـ Custom وكيفية استخدامها.`
            );

        const botThumbnail = new ThumbnailBuilder()
            .setURL(client.user.displayAvatarURL({ size: 256 }));

        const headerSection = new SectionBuilder()
            .addTextDisplayComponents(headerText)
            .setThumbnailAccessory(botThumbnail);

        const sep1 = new SeparatorBuilder()
            .setSpacing(SeparatorSpacingSize.Small)
            .setDivider(true);

        // 2. Command details list
        const commands = [
            {
                name: "play",
                aliases: ["p", "شغل", "ش"],
                desc: "تشغيل الموسيقى من يوتيوب، سبوتيفاي، أو ساوند كلاود.",
                emoji: "🎶"
            },
            {
                name: "search",
                aliases: ["بحث", "دور"],
                desc: "البحث عن الأغاني واختيارها من قائمة نتائج يوتيوب.",
                emoji: "🔍"
            },
            {
                name: "stop",
                aliases: ["وقف", "إيقاف", "end"],
                desc: "إيقاف التشغيل الحالي تماماً ومسح قائمة الانتظار.",
                emoji: "⏹️"
            },
            {
                name: "volume",
                aliases: ["vol", "v", "صوت"],
                desc: "التحكم في مستوى الصوت (من 0 إلى 100).",
                emoji: "🔊"
            },
            {
                name: "skip",
                aliases: ["s", "تخطي", "بعده"],
                desc: "تخطي الأغنية الحالية وتشغيل الأغنية التالية.",
                emoji: "⏭️"
            },
            {
                name: "language",
                aliases: ["لغه", "لغة"],
                desc: "عرض وتغيير لغة البوت داخل السيرفر.",
                emoji: "🌍"
            },
            {
                name: "playlist",
                aliases: ["list", "pl", "قائمة"],
                desc: "إدارة قوائم التشغيل الخاصة بك (إنشاء، حذف، إضافة أغاني، وتشغيل).",
                emoji: "📋"
            },
            {
                name: "ping",
                aliases: ["بينج"],
                desc: "فحص سرعة استجابة البوت مع خوادم الديسكورد.",
                emoji: "📶"
            }
        ];

        let commandListContent = "";
        for (const cmd of commands) {
            commandListContent += `### ${cmd.emoji} \`${prefix}${cmd.name}\`\n`;
            commandListContent += `> ${cmd.desc}\n`;
            if (cmd.aliases && cmd.aliases.length > 0) {
                // Using subtext format for a cleaner look
                commandListContent += `-# **الاختصارات:** \`${cmd.aliases.join("\`, \`")}\`\n`;
            }
            // commandListContent += `\n`;
        }

        const bodyDisplay = new TextDisplayBuilder()
            .setContent(commandListContent);

        const sep2 = new SeparatorBuilder()
            .setSpacing(SeparatorSpacingSize.Small)
            .setDivider(true);

        // 3. Footer Section (Tips)
        const footerText = new TextDisplayBuilder()
            .setContent(
                `### 💡 ملاحظات سريعة:\n` +
                `- جميع الأوامر تدعم البادئة (\`${prefix}\`) أو كتابة الاختصارات مباشرة.\n` +
                `- لطلب الدعم الفني، استخدم الزر الموجود بالأسفل.`
            );

        // 4. Building the UI Container (Components V2)
        const container = new ContainerBuilder()
            .setAccentColor(parseInt((config.bot.embedColor || '#2B2D31').replace('#', ''), 16))
            .addSectionComponents(headerSection)
            .addSeparatorComponents(sep1)
            .addTextDisplayComponents(bodyDisplay)
            .addSeparatorComponents(sep2)
            .addTextDisplayComponents(footerText);

        // 5. Action Buttons (Links)
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel("الموقع الرسمي")
                .setURL(config.bot.website || "https://example.com")
                .setStyle(ButtonStyle.Link),
            new ButtonBuilder()
                .setLabel("سيرفر الدعم")
                .setURL(config.bot.supportServer || "https://discord.gg/example")
                .setStyle(ButtonStyle.Link)
        );

        await message.reply({
            flags: MessageFlags.IsComponentsV2,
            components: [container, row],
            allowedMentions: { repliedUser: false }
        });
    }
};
