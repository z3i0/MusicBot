const { PermissionFlagsBits } = require("discord.js");
const MusicPlayer = require("../../src/MusicPlayer");
const MusicEmbedManager = require("../../src/MusicEmbedManager");
const LanguageManager = require("../../src/LanguageManager");
const chalk = require("chalk");

module.exports = {
    name: "play",
    aliases: ["p", "شغل", "ش"],
    description: "Plays music - supports YouTube, Spotify, SoundCloud or direct links",
    async execute(message, args, client) {
        try {
            const query = args.join(" ");
            const guild = message.guild;
            const member = message.member || await guild.members.fetch(message.author.id).catch(() => null);
            const channel = message.channel;

            // Validation: user provided a query
            if (!query) {
                return message.reply({
                    content: "❌ Please provide a song name or URL to play!",
                    allowedMentions: { repliedUser: false }
                });
            }

            // Validation: user in a voice channel
            if (!member || !member.voice || !member.voice.channel) {
                return message.reply({
                    content: "🎧 You must be in a voice channel to play music!",
                    allowedMentions: { repliedUser: false }
                });
            }

            // Validate permissions and voice channel
            const validationResult = await this.validateRequest(message, member, guild);
            if (!validationResult.success) {
                if (validationResult.message) {
                    return message.reply({
                        content: validationResult.message,
                        allowedMentions: { repliedUser: false }
                    });
                }
                return;
            }

            // Get or create player
            let player = client.players.get(guild.id);
            if (!player) {
                player = new MusicPlayer(guild, channel, member.voice.channel, client.config.slug);
                client.players.set(guild.id, player);
            }

            // Update player's channels
            player.voiceChannel = member.voice.channel;
            player.textChannel = channel;

            // Send searching message
            const searchingMsg =
                (await LanguageManager.getTranslation(
                    guild.id,
                    "commands.play.searching_desc",
                    { query }
                ).catch(() => null)) || `🔍 Searching for **${query}**...`;

            const searchingMessage = await message.reply({
                content: searchingMsg,
                allowedMentions: { repliedUser: false }
            });

            // Fetch track data
            const trackData = await this.getTrackData(query, guild.id, message.author.id);

            if (!trackData.success) {
                return searchingMessage.edit({
                    content: trackData.message || "❌ No results found.",
                    allowedMentions: { repliedUser: false }
                });
            }

            // Initialize embed manager if not ready
            if (!client.musicEmbedManager) {
                client.musicEmbedManager = new MusicEmbedManager(client);
            }

            // Send the embed via embed manager
            const embedResult = await client.musicEmbedManager.handleMusicData(
                guild.id,
                trackData,
                member,
                message
            );

            if (!embedResult.success) {
                return searchingMessage.edit({
                    content: embedResult.message,
                    allowedMentions: { repliedUser: false }
                });
            }

            // Use reaction for success if handled by EmbedManager
            if (embedResult.success) {
                // Delete searching message if still exists
                await searchingMessage.delete().catch(() => { });
                return;
            }

        } catch (error) {
            console.error(chalk.red("❌ Error executing play command:"), error);
            try {
                await message.reply({
                    content: "⚠️ An error occurred while trying to play the track.",
                    allowedMentions: { repliedUser: false }
                });
            } catch (replyErr) {
                console.error("Error sending fallback message:", replyErr);
            }
        }
    },

    async validateRequest(message, member, guild) {
        // Text channel permissions check
        const textChannelPermissions = message.channel.permissionsFor(guild.members.me);
        if (!textChannelPermissions.has(PermissionFlagsBits.SendMessages)) {
            return { success: false };
        }

        // Voice channel check
        if (!member || !member.voice || !member.voice.channel) {
            const errorMsg = await LanguageManager.getTranslation(
                guild.id,
                "commands.play.voice_channel_required"
            ).catch(() => "❌ You must be in a voice channel to use this command.");
            return { success: false, message: errorMsg };
        }

        // Permission check
        const permissions = member.voice.channel.permissionsFor(guild.members.me);
        if (
            !permissions.has(PermissionFlagsBits.Connect) ||
            !permissions.has(PermissionFlagsBits.Speak)
        ) {
            return { success: false };
        }

        // Bot in another channel?
        const botVoiceChannel = guild.members.me.voice.channel;
        if (botVoiceChannel && botVoiceChannel.id !== member.voice.channel.id) {
            const errorMsg = await LanguageManager.getTranslation(
                guild.id,
                "commands.play.same_channel_required"
            ).catch(() => "❌ You must be in the same voice channel as the bot.");
            return { success: false, message: errorMsg };
        }

        return { success: true };
    },

    async getTrackData(query, guildId, userId) {
        const YouTube = require("../../src/YouTube");
        const Spotify = require("../../src/Spotify");
        const SoundCloud = require("../../src/SoundCloud");
        const DirectLink = require("../../src/DirectLink");
        const { Playlist, PlaylistItem } = require("../../models");

        try {
            let tracks = [];
            let isPlaylist = false;

            // 1. Check if it's a personal playlist first
            const personalPlaylist = await Playlist.findOne({
                where: { userId, name: query },
                include: [{ model: PlaylistItem, as: "items", order: [["createdAt", "ASC"]] }]
            });

            if (personalPlaylist && personalPlaylist.items.length > 0) {
                tracks = personalPlaylist.items.map(item => ({
                    title: item.title,
                    url: item.url,
                    thumbnail: item.thumbnail,
                    duration: item.duration,
                    artist: item.artist,
                    platform: item.platform || "youtube",
                    type: "track"
                }));
                return { success: true, isPlaylist: true, tracks };
            }

            // 2. Detect platform for normal search
            const platform = this.detectPlatform(query);

            switch (platform) {
                case "youtube":
                    if (YouTube.isPlaylist && YouTube.isPlaylist(query)) {
                        const playlistData = await YouTube.getPlaylist(query, guildId);
                        if (playlistData?.tracks?.length > 0) {
                            tracks = playlistData.tracks;
                            isPlaylist = true;
                        } else {
                            tracks = await YouTube.search(query, 1, guildId);
                        }
                    } else {
                        tracks = await YouTube.search(query, 1, guildId);
                    }
                    break;

                case "spotify":
                    if (Spotify.isSpotifyURL(query)) {
                        const spotifyData = await Spotify.getFromURL(query, guildId);
                        tracks = spotifyData || [];
                        const { type } = Spotify.parseSpotifyURL(query);
                        isPlaylist = ["playlist", "album", "artist"].includes(type);
                    } else {
                        const spotifyData = await Spotify.search(query, 1, "track", guildId);
                        tracks = spotifyData || [];
                    }
                    break;

                case "soundcloud":
                    tracks = (await SoundCloud.search(query, 1, guildId)) || [];
                    break;

                case "direct":
                    tracks = (await DirectLink.getInfo(query)) || [];
                    break;

                default:
                    tracks = await YouTube.search(query, 1, guildId);
            }

            if (!tracks.length) {
                const errorMsg = await LanguageManager.getTranslation(
                    guildId,
                    "musicplayer.no_results_found"
                ).catch(() => "❌ No results found for your search.");
                return { success: false, message: errorMsg };
            }

            return { success: true, isPlaylist, tracks };
        } catch (error) {
            const errorMsg = await LanguageManager.getTranslation(
                guildId,
                "commands.play.error_searching"
            ).catch(() => "⚠️ Error while searching for the track.");
            return { success: false, message: errorMsg };
        }
    },

    detectPlatform(query) {
        if (query.includes("youtube.com") || query.includes("youtu.be")) return "youtube";
        if (query.includes("spotify.com")) return "spotify";
        if (query.includes("soundcloud.com")) return "soundcloud";
        if (
            query.startsWith("http") &&
            (query.endsWith(".mp3") || query.endsWith(".wav") || query.endsWith(".ogg"))
        )
            return "direct";
        return "youtube"; // Default
    },
};