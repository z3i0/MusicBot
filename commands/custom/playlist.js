const { EmbedBuilder } = require("discord.js");
const { Playlist, PlaylistItem } = require("../../models");
const LanguageManager = require("../../src/LanguageManager");
const YouTube = require("../../src/YouTube");
const Spotify = require("../../src/Spotify");
const SoundCloud = require("../../src/SoundCloud");
const config = require("../../config");

module.exports = {
    name: "playlist",
    aliases: ["list", "pl", "قائمة"],
    description: "Manage your personal playlists.",
    async execute(message, args, client) {
        const guildId = message.guild.id;
        const userId = message.author.id;
        const subCommand = args[0]?.toLowerCase();

        const t = (key, vars = {}) => LanguageManager.getTranslation(guildId, `commands.playlist.${key}`, { prefix: client.prefix, ...vars });

        if (!subCommand) {
            return this.sendUsage(message, t, client.prefix);
        }

        switch (subCommand) {
            case "create":
                await this.handleCreate(message, args.slice(1), userId, t);
                break;
            case "delete":
                await this.handleDelete(message, args.slice(1), userId, t);
                break;
            case "add":
                await this.handleAdd(message, args.slice(1), userId, t, client);
                break;
            case "remove":
                await this.handleRemove(message, args.slice(1), userId, t);
                break;
            case "list":
                await this.handleList(message, userId, t);
                break;
            case "show":
                await this.handleShow(message, args.slice(1), userId, t);
                break;
            case "play":
                await this.handlePlay(message, args.slice(1), userId, t, client);
                break;
            default:
                await this.sendUsage(message, t, client.prefix);
        }
    },

    async sendUsage(message, t, prefix) {
        const embed = new EmbedBuilder()
            .setTitle(await t("usage_title"))
            .setColor(config.bot.embedColor || "#00FF00")
            .setDescription(await t("usage_desc"))
            .addFields([
                { name: `➕ ${await t("create_title")}`, value: `\`${prefix}playlist create <name>\`\n*${await t("create_desc")}*` },
                { name: `❌ ${await t("delete_title")}`, value: `\`${prefix}playlist delete <name>\`\n*${await t("delete_desc")}*` },
                { name: `🎵 ${await t("add_title")}`, value: `\`${prefix}playlist add <name> <query/url>\`\n*${await t("add_desc")}*` },
                { name: `➖ ${await t("remove_title")}`, value: `\`${prefix}playlist remove <name> <song_number>\`\n*${await t("remove_desc")}*` },
                { name: `📋 ${await t("list_title")}`, value: `\`${prefix}playlist list\`\n*${await t("list_desc")}*` },
                { name: `🔍 ${await t("show_title")}`, value: `\`${prefix}playlist show <name>\`\n*${await t("show_desc")}*` },
                { name: `▶️ ${await t("play_title")}`, value: `\`${prefix}playlist play <name>\`\n*${await t("play_desc")}*` }
            ])
            .setFooter({ text: message.author.tag, iconURL: message.author.displayAvatarURL() })
            .setTimestamp();

        return message.reply({
            embeds: [embed],
            allowedMentions: { repliedUser: false }
        });
    },

    async handleCreate(message, args, userId, t) {
        const name = args.join(" ");
        if (!name) return this.sendUsage(message, t, LanguageManager.getPrefix(message.guild.id));

        try {
            const [playlist, created] = await Playlist.findOrCreate({
                where: { userId, name },
                defaults: { userId, name }
            });

            if (!created) {
                return message.reply({ content: await t("already_exists"), allowedMentions: { repliedUser: false } });
            }

            message.reply({ content: await t("created", { name }), allowedMentions: { repliedUser: false } });
        } catch (error) {
            console.error(error);
            message.reply({ content: "❌ Error creating playlist.", allowedMentions: { repliedUser: false } });
        }
    },

    async handleDelete(message, args, userId, t) {
        const name = args.join(" ");
        if (!name) return this.sendUsage(message, t, LanguageManager.getPrefix(message.guild.id));

        try {
            const deleted = await Playlist.destroy({ where: { userId, name } });
            if (!deleted) return message.reply({ content: await t("not_found"), allowedMentions: { repliedUser: false } });

            message.reply({ content: await t("deleted", { name }), allowedMentions: { repliedUser: false } });
        } catch (error) {
            console.error(error);
            message.reply({ content: "❌ Error deleting playlist.", allowedMentions: { repliedUser: false } });
        }
    },

    async handleAdd(message, args, userId, t, client) {
        if (args.length < 2) return this.sendUsage(message, t, client.prefix);

        const name = args[0];
        const query = args.slice(1).join(" ");

        try {
            const playlist = await Playlist.findOne({ where: { userId, name } });
            if (!playlist) return message.reply({ content: await t("not_found"), allowedMentions: { repliedUser: false } });

            const searchingMsg = await message.reply({ content: "🔍 Searching for track...", allowedMentions: { repliedUser: false } });

            let track = null;
            if (Spotify.isSpotifyURL(query)) {
                const tracks = await Spotify.getFromURL(query, message.guild.id);
                if (tracks && tracks.length > 0) track = tracks[0];
            } else if (SoundCloud.isSoundCloudURL(query)) {
                const tracks = await SoundCloud.search(query, 1, message.guild.id);
                if (tracks && tracks.length > 0) track = tracks[0];
            } else {
                const tracks = await YouTube.search(query, 1, message.guild.id);
                if (tracks && tracks.length > 0) track = tracks[0];
            }

            if (!track) {
                return searchingMsg.edit({ content: "❌ No results found." });
            }

            await PlaylistItem.create({
                playlistId: playlist.id,
                title: track.title,
                url: track.url,
                thumbnail: track.thumbnail,
                duration: track.duration,
                artist: track.artist,
                platform: track.platform
            });

            searchingMsg.edit({ content: await t("added", { title: track.title, name }) });
        } catch (error) {
            console.error(error);
            message.reply({ content: "❌ Error adding to playlist.", allowedMentions: { repliedUser: false } });
        }
    },

    async handleRemove(message, args, userId, t) {
        if (args.length < 2) return this.sendUsage(message, t, LanguageManager.getPrefix(message.guild.id));

        const name = args[0];
        const index = parseInt(args[1]) - 1;

        if (isNaN(index) || index < 0) return message.reply({ content: await t("invalid_index"), allowedMentions: { repliedUser: false } });

        try {
            const playlist = await Playlist.findOne({
                where: { userId, name },
                include: [{ model: PlaylistItem, as: "items", order: [["createdAt", "ASC"]] }]
            });

            if (!playlist) return message.reply({ content: await t("not_found"), allowedMentions: { repliedUser: false } });

            const items = await PlaylistItem.findAll({
                where: { playlistId: playlist.id },
                order: [["createdAt", "ASC"]]
            });

            if (!items[index]) return message.reply({ content: await t("invalid_index"), allowedMentions: { repliedUser: false } });

            await items[index].destroy();
            message.reply({ content: await t("removed"), allowedMentions: { repliedUser: false } });
        } catch (error) {
            console.error(error);
            message.reply({ content: "❌ Error removing from playlist.", allowedMentions: { repliedUser: false } });
        }
    },

    async handleList(message, userId, t) {
        try {
            const playlists = await Playlist.findAll({
                where: { userId },
                include: [{ model: PlaylistItem, as: "items" }]
            });

            if (playlists.length === 0) {
                return message.reply({ content: await t("no_playlists"), allowedMentions: { repliedUser: false } });
            }

            const embed = new EmbedBuilder()
                .setTitle(await t("my_playlists"))
                .setColor(config.bot.embedColor || "#00FF00")
                .setDescription(playlists.map(p => `• **${p.name}** (${p.items.length} songs)`).join("\n"));

            message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
        } catch (error) {
            console.error(error);
            message.reply({ content: "❌ Error listing playlists.", allowedMentions: { repliedUser: false } });
        }
    },

    async handleShow(message, args, userId, t) {
        const name = args.join(" ");
        if (!name) return this.sendUsage(message, t, LanguageManager.getPrefix(message.guild.id));

        try {
            const playlist = await Playlist.findOne({
                where: { userId, name },
                include: [{ model: PlaylistItem, as: "items", order: [["createdAt", "ASC"]] }]
            });

            if (!playlist) return message.reply({ content: await t("not_found"), allowedMentions: { repliedUser: false } });

            const items = await PlaylistItem.findAll({
                where: { playlistId: playlist.id },
                order: [["createdAt", "ASC"]]
            });

            if (items.length === 0) return message.reply({ content: await t("empty"), allowedMentions: { repliedUser: false } });

            const tracksList = items.map((item, i) => `\`${i + 1}.\` **[${item.title.substring(0, 50)}](${item.url})**`).join("\n");

            const embed = new EmbedBuilder()
                .setTitle(await t("tracks_in", { name }))
                .setColor(config.bot.embedColor || "#00FF00")
                .setDescription(tracksList.substring(0, 4000));

            message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
        } catch (error) {
            console.error(error);
            message.reply({ content: "❌ Error showing playlist.", allowedMentions: { repliedUser: false } });
        }
    },

    async handlePlay(message, args, userId, t, client) {
        const name = args.join(" ");
        if (!name) return this.sendUsage(message, t, client.prefix);

        try {
            const playlist = await Playlist.findOne({ where: { userId, name } });
            if (!playlist) return message.reply({ content: await t("not_found"), allowedMentions: { repliedUser: false } });

            const items = await PlaylistItem.findAll({
                where: { playlistId: playlist.id },
                order: [["createdAt", "ASC"]]
            });

            if (items.length === 0) return message.reply({ content: await t("empty"), allowedMentions: { repliedUser: false } });

            // Check voice channel
            if (!message.member.voice.channel) {
                return message.reply({ content: "❌ You must be in a voice channel to play music!", allowedMentions: { repliedUser: false } });
            }

            const MusicPlayer = require("../../src/MusicPlayer");
            const MusicEmbedManager = require("../../src/MusicEmbedManager");
            let player = client.players.get(message.guild.id);

            if (!player) {
                player = new MusicPlayer(message.guild, message.channel, message.member.voice.channel, client.config.slug);
                client.players.set(message.guild.id, player);
            }

            // Map database items to tracks
            const tracks = items.map(item => ({
                title: item.title,
                url: item.url,
                thumbnail: item.thumbnail,
                duration: item.duration,
                artist: item.artist,
                platform: item.platform || "youtube",
                type: "track"
            }));

            // Initialize embed manager if not ready
            if (!client.musicEmbedManager) {
                client.musicEmbedManager = new MusicEmbedManager(client);
            }

            const trackData = { success: true, isPlaylist: true, tracks };

            // Send the embed via embed manager for professional UI
            const embedResult = await client.musicEmbedManager.handleMusicData(
                message.guild.id,
                trackData,
                message.member,
                message
            );

            if (!embedResult.success) {
                message.reply({ content: embedResult.message, allowedMentions: { repliedUser: false } });
            }

        } catch (error) {
            console.error(error);
            message.reply({ content: "❌ Error playing playlist.", allowedMentions: { repliedUser: false } });
        }
    }
};
