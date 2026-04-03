const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    BaseInteraction,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ThumbnailBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    SectionBuilder,
    MessageFlags
} = require('discord.js');
const config = require('../config');
const LanguageManager = require('./LanguageManager');

class MusicEmbedManager {
    constructor(client) {
        this.client = client;
        this.processingQueue = new Map();
    }

    async sequentialPreload(player, tracks) {
        for (const track of tracks) {
            if (player.preloadedStreams.has(track.url) || player.preloadingQueue.includes(track.url)) continue;
            try {
                await player.preloadTrack(track);
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (err) {
                console.error(`❌ Preload error for ${track.title}:`, err.message);
            }
        }
    }

    async handleMusicData(guildId, trackData, member, interaction = null) {
        if (this.processingQueue.has(guildId)) {
            await this.processingQueue.get(guildId);
        }
        const processingPromise = this._processMusic(guildId, trackData, member, interaction);
        this.processingQueue.set(guildId, processingPromise);
        try {
            return await processingPromise;
        } finally {
            this.processingQueue.delete(guildId);
        }
    }

    async _processMusic(guildId, trackData, member, interaction) {
        const player = this.client.players.get(guildId);
        if (!player) return { success: false, message: 'No player found' };

        const wasPlayingBefore = player.currentTrack !== null;
        const isPlaylist = trackData.isPlaylist || false;
        const tracks = trackData.tracks;

        try {
            let firstTrackResult = null;
            const wasIdle = (!player.currentTrack && player.queue.length === 0);

            for (let i = 0; i < tracks.length; i++) {
                const track = { ...tracks[i] };
                track.requestedBy = member;
                track.addedAt = Date.now();

                if (i === 0 && wasIdle) {
                    player.currentTrack = track;
                    try {
                        if (!player.connection) await player.connect();
                        await player.play();
                        firstTrackResult = await this.createNewMusicEmbed(player, track, member, interaction);
                    } catch (playError) {
                        console.error('Error in play process:', playError);
                        player.currentTrack = null;
                        player.queue.push(track);
                    }
                } else {
                    player.queue.push(track);
                }
            }

            this.sequentialPreload(player, player.queue.slice()).catch(err =>
                console.error('❌ Sequential preload error:', err.message)
            );

            if (firstTrackResult && tracks.length > 1) {
                await this.showPlaylistAdditionMessage(player, tracks, member, interaction, isPlaylist);
                await this.updateNowPlayingEmbed(player);
                return firstTrackResult;
            }

            if (wasPlayingBefore || (!firstTrackResult && tracks.length > 0)) {
                return await this.handleQueueAddition(player, tracks, member, interaction, isPlaylist);
            }

            return firstTrackResult || { success: true, message: 'Track processed successfully' };
        } catch (error) {
            return { success: false, message: 'Error processing music' };
        }
    }

    async showPlaylistAdditionMessage(player, tracks, member, interaction, isPlaylist) {
        const remainingTracks = tracks.slice(1);
        const messageText = await this.createQueueAdditionMessage(remainingTracks, member.guild.id, isPlaylist);
        try {
            if (interaction && typeof interaction.react === 'function') {
                // Legacy message-based command: react instead of sending a message
                await interaction.react('✅').catch(() => { });
                return;
            }

            const infoMessage = await player.textChannel.send({ content: messageText });
            setTimeout(async () => {
                try { await infoMessage.delete(); } catch { }
            }, 10000);
        } catch (error) {
            console.error('Error sending playlist addition message:', error);
        }
    }

    async createNewMusicEmbed(player, track, member, interaction) {
        const components = await this.buildNowPlayingComponents(player, track, member.guild.id);
        const buttons = await this.createControlButtons(player);
        const payload = {
            flags: MessageFlags.IsComponentsV2,
            components: [...components, ...buttons]
        };

        let message;
        if (interaction instanceof BaseInteraction) {
            if (interaction.deferred || interaction.replied) {
                message = await interaction.editReply(payload);
            } else {
                message = await interaction.reply(payload);
            }
        } else if (interaction && typeof interaction.reply === 'function') {
            message = await interaction.reply({ ...payload, allowedMentions: { repliedUser: false } });
        } else {
            message = await player.textChannel.send(payload);
        }

        player.nowPlayingMessage = message;
        player.requesterId = member.id;
        return { success: true, message: 'Now playing', isNewEmbed: true };
    }

    async handleQueueAddition(player, tracks, member, interaction, isPlaylist) {
        if (player.nowPlayingMessage && player.currentTrack) {
            await this.updateNowPlayingEmbed(player);
        }

        const messageText = await this.createQueueAdditionMessage(tracks, member.guild.id, isPlaylist);

        let infoMessage;
        if (interaction instanceof BaseInteraction) {
            if (interaction.deferred || interaction.replied) {
                // If it's a search interaction response, we might want to update the existing message
                // but usually interactions prefer a response.
                // For slash commands, we still use the text reply.
                infoMessage = await interaction.editReply({ content: messageText, components: [] });
            } else {
                infoMessage = await interaction.reply({ content: messageText, flags: [1 << 6] });
            }
        } else if (interaction && typeof interaction.react === 'function') {
            // Legacy message-based command: react instead of sending a message
            await interaction.react('✅').catch(() => { });
            return { success: true, message: 'Added to queue', isNewEmbed: false, reacted: true };
        } else if (interaction && typeof interaction.reply === 'function') {
            infoMessage = await interaction.reply({ content: messageText, allowedMentions: { repliedUser: false } });
        } else {
            infoMessage = await player.textChannel.send({ content: messageText });
        }

        if (infoMessage) {
            setTimeout(async () => {
                try { await infoMessage.delete(); } catch { }
            }, 10000);
        }

        return { success: true, message: 'Added to queue', isNewEmbed: false };
    }

    /**
     * بناء Components V2 للـ Now Playing
     */
    async buildNowPlayingComponents(player, track, guildId) {
        const requester = track.requestedBy ? track.requestedBy.user || track.requestedBy : null;
        const platformEmoji = this.getPlatformEmoji(track.platform);
        const platformName = track.platform
            ? track.platform.charAt(0).toUpperCase() + track.platform.slice(1)
            : 'Unknown';

        const statusIcon = player.paused ? '⏸️' : '▶️';
        const loopIcon = player.loop === 'track' ? '🔂' : player.loop === 'queue' ? '🔁' : '➡️';
        const volumeBar = this.createVolumeBar(player.volume);

        // ─── Header: Now Playing ───
        const headerText = new TextDisplayBuilder()
            .setContent(`🎵  **NOW PLAYING**`);

        const sep1 = new SeparatorBuilder()
            .setSpacing(SeparatorSpacingSize.Small)
            .setDivider(true);

        // ─── Section: Thumbnail + Track Info ───
        const thumbnail = new ThumbnailBuilder()
            .setURL(track.thumbnail || 'https://i.imgur.com/placeholder.png');

        const truncTitle = track.title.length > 55
            ? track.title.substring(0, 52) + '...'
            : track.title;

        const trackInfoText = new TextDisplayBuilder()
            .setContent(
                `### [${truncTitle}](${track.url})\n` +
                `${platformEmoji}  **${platformName}**  ·  👤 **${track.artist || 'Unknown'}**`
            );

        const trackSection = new SectionBuilder()
            .addTextDisplayComponents(trackInfoText)
            .setThumbnailAccessory(thumbnail);

        // ─── Separator ───
        const sep2 = new SeparatorBuilder()
            .setSpacing(SeparatorSpacingSize.Small)
            .setDivider(true);

        // ─── Stats Row ───
        const statusKey = player.paused ? 'commands.nowplaying.status_paused' : 'commands.nowplaying.status_playing';
        let statusText = await LanguageManager.getTranslation(guildId, statusKey);
        if (player.pauseReasons?.has('mute')) statusText += ' 🔇';
        else if (player.pauseReasons?.has('alone')) statusText += ' ⏳';

        const statsText = new TextDisplayBuilder()
            .setContent(
                `-# ${statusText}  ·  ${loopIcon}  Loop: **${player.loop ? (typeof player.loop === 'string' ? player.loop.charAt(0).toUpperCase() + player.loop.slice(1) : 'On') : 'Off'}**  ·  🔊  ${volumeBar}  **${player.volume}%**`
            );

        // ─── Separator ───
        const sep3 = new SeparatorBuilder()
            .setSpacing(SeparatorSpacingSize.Small)
            .setDivider(true);

        // ─── Requester + Next Track ───
        let nextLine = `🔜  **Up Next:** \`Nothing in queue\``;
        if (player.queue.length > 0) {
            const next = player.queue[0];
            const nextTitle = next.title.length > 45
                ? next.title.substring(0, 42) + '...'
                : next.title;
            nextLine = `🔜  **Up Next:** [${nextTitle}](${next.url})`;
        }

        const footerText = new TextDisplayBuilder()
            .setContent(
                `-# 👤  Requested by ${requester ? `**${requester}**` : '`Unknown`'}  ·  📋  Queue: **${player.queue.length}** track${player.queue.length !== 1 ? 's' : ''}\n` +
                `-# ${nextLine}`
            );

        // ─── Container ───
        const container = new ContainerBuilder()
            .setAccentColor(parseInt((config.bot.embedColor || '#2B2D31').replace('#', ''), 16))
            .addTextDisplayComponents(headerText)
            .addSeparatorComponents(sep1)
            .addSectionComponents(trackSection)
            .addSeparatorComponents(sep2)
            .addTextDisplayComponents(statsText)
            .addSeparatorComponents(sep3)
            .addTextDisplayComponents(footerText);

        return [container];
    }

    /**
     * Volume bar بسيط
     */
    createVolumeBar(volume) {
        const filled = Math.round(volume / 10);
        const empty = 10 - filled;
        return '█'.repeat(filled) + '░'.repeat(empty);
    }

    /**
     * تحديث الـ embed الحالي
     */
    async updateNowPlayingEmbed(player) {
        if (!player.nowPlayingMessage || !player.currentTrack) return;
        try {
            const components = await this.buildNowPlayingComponents(player, player.currentTrack, player.guild.id);
            const buttons = await this.createControlButtons(player);
            await player.nowPlayingMessage.edit({
                flags: MessageFlags.IsComponentsV2,
                components: [...components, ...buttons]
            });
        } catch (error) {
            console.error('Error updating now playing embed:', error);
        }
    }

    async handleTrackEnd(player) {
        if (player.queue.length > 0) {
            player.currentTrack = player.queue.shift();
            await player.play();
            await this.updateNowPlayingEmbed(player);
        } else {
            await this.handlePlaybackEnd(player);
        }
    }

    async handlePlaybackEnd(player) {
        if (player.nowPlayingMessage) {
            try {
                const disabledButtons = await this.createControlButtons(player, true);

                // If we still have a track reference, update with the design preserved
                if (player.currentTrack) {
                    const components = await this.buildNowPlayingComponents(player, player.currentTrack, player.guild.id);
                    await player.nowPlayingMessage.edit({
                        flags: MessageFlags.IsComponentsV2,
                        components: [...components, ...disabledButtons]
                    });
                } else {
                    // Fallback: just disable the buttons
                    await player.nowPlayingMessage.edit({
                        flags: MessageFlags.IsComponentsV2,
                        components: disabledButtons
                    });
                }
            } catch (error) {
                console.error('Error disabling buttons on playback end:', error);
            }
        }
        player.currentTrack = null;
        player.nowPlayingMessage = null;
    }

    /**
     * Array Button
     */
    async createControlButtons(player, disabled = false) {
        const guildId = player.guild.id;
        const sessionId = player.sessionId;
        const requesterId = player.requesterId;

        const t = (key) => LanguageManager.getTranslation(guildId, key);

        const pauseLabel = player.paused ? await t('buttons.resume') : await t('buttons.pause');

        // ─── Row 1: Playback Controls ───
        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`music_seek_back:${requesterId}:${sessionId}`)
                .setEmoji('⏪')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled),

            new ButtonBuilder()
                .setCustomId(`music_pause:${requesterId}:${sessionId}`)
                .setLabel(pauseLabel)
                .setEmoji(player.paused ? '▶️' : '⏸️')
                .setStyle(player.paused ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setDisabled(disabled),

            new ButtonBuilder()
                .setCustomId(`music_seek_forward:${requesterId}:${sessionId}`)
                .setEmoji('⏩')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled),

            new ButtonBuilder()
                .setCustomId(`music_skip:${requesterId}:${sessionId}`)
                .setLabel(await t('buttons.skip'))
                .setEmoji('⏭️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled || player.queue.length === 0),

            new ButtonBuilder()
                .setCustomId(`music_stop:${requesterId}:${sessionId}`)
                .setLabel(await t('buttons.stop'))
                .setEmoji('⏹️')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(disabled)
        );

        // ─── Row 2: Settings ───
        let loopLabel, loopEmoji, loopStyle;
        if (player.loop === 'track') {
            loopLabel = await t('buttons.loop_track');
            loopEmoji = '🔂';
            loopStyle = ButtonStyle.Success;
        } else if (player.loop === 'queue') {
            loopLabel = await t('buttons.loop_queue');
            loopEmoji = '🔁';
            loopStyle = ButtonStyle.Success;
        } else {
            loopLabel = await t('buttons.loop_off');
            loopEmoji = '➡️';
            loopStyle = ButtonStyle.Secondary;
        }

        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`music_volume:${requesterId}:${sessionId}`)
                .setLabel(await t('buttons.volume'))
                .setEmoji('🔊')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled),

            new ButtonBuilder()
                .setCustomId(`music_loop:${requesterId}:${sessionId}`)
                .setLabel(loopLabel)
                .setEmoji(loopEmoji)
                .setStyle(loopStyle)
                .setDisabled(disabled),

            new ButtonBuilder()
                .setCustomId(`music_shuffle:${requesterId}:${sessionId}`)
                .setLabel(await t('buttons.shuffle'))
                .setEmoji('🔀')
                .setStyle(player.shuffle ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setDisabled(disabled),

            new ButtonBuilder()
                .setCustomId(`music_queue:${requesterId}:${sessionId}`)
                .setLabel(await t('buttons.queue'))
                .setEmoji('📋')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(disabled),

            new ButtonBuilder()
                .setCustomId(`music_autoplay:${requesterId}:${sessionId}`)
                .setEmoji('🎲')
                .setStyle(player.autoplay ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setDisabled(disabled)
        );

        // ─── Row 3: Extras (Lyrics) ───
        const row3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`music_lyrics:${requesterId}:${sessionId}`)
                .setLabel(await t('buttons.lyrics') || 'Lyrics')
                .setEmoji('🎤')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled || !player.hasLyrics()),

            new ButtonBuilder()
                .setCustomId(`music_live_lyrics:${requesterId}:${sessionId}`)
                .setLabel(await t('buttons.live_lyrics') || 'Live Lyrics')
                .setEmoji('🎞️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled || !player.currentLyrics?.parsed)
        );

        return [row1, row2, row3];
    }

    async createQueueAdditionMessage(tracks, guildId, isPlaylist) {
        if (isPlaylist) {
            return await LanguageManager.getTranslation(guildId, 'musicmanager.playlist_added_to_queue', {
                count: tracks.length
            });
        }
        const track = tracks[0];
        return await LanguageManager.getTranslation(guildId, 'musicmanager.track_added_to_queue', {
            title: track?.title || 'Unknown Track'
        });
    }

    getPlatformEmoji(platform) {
        const emojis = {
            youtube: '🔴',
            spotify: '🟢',
            soundcloud: '🟠',
            direct: '🔗'
        };
        return emojis[platform] || '🎵';
    }
}

module.exports = MusicEmbedManager;