const axios = require('axios');
const Genius = require('genius-lyrics');
const config = require('../config');

class LyricsManager {
    constructor() {
        this.cache = new Map(); // Cache lyrics by track URL
        this.cacheTimers = new Map(); // Track cache expiration timers

        // Initialize Genius client (works without token via web scraping)
        // Token can be added later for higher rate limits: new Genius.Client(token)
        this.geniusClient = new Genius.Client();
    }



    getCacheKey(track) {
        if (!track) return 'unknown';
        const title = (track.title || '').toLowerCase();
        const artist = (track.artist || track.uploader || '').toLowerCase();
        return `${title}-${artist}` || title || 'unknown';
    }

    storeInCache(cacheKey, data, ttlMs = null) {
        if (!cacheKey) return;

        this.cache.set(cacheKey, data);

        if (this.cacheTimers.has(cacheKey)) {
            clearTimeout(this.cacheTimers.get(cacheKey));
        }

        const effectiveTtl = typeof ttlMs === 'number' ? ttlMs : (data ? 3600000 : 300000);

        const timer = setTimeout(() => {
            this.cache.delete(cacheKey);
            this.cacheTimers.delete(cacheKey);
        }, effectiveTtl);

        if (typeof timer.unref === 'function') {
            timer.unref();
        }

        this.cacheTimers.set(cacheKey, timer);
    }

    cleanTrackTitle(title = '') {
        return title
            .replace(/\(.*?\)/g, '') // Remove parentheses content
            .replace(/\[.*?\]/g, '') // Remove brackets content
            .replace(/【.*?】/g, '') // Remove Japanese-style brackets
            .replace(/v[iï]de[oó]/gi, '')
            .replace(/official|audio|video|lyrics?|full\s?hd|hd|4k|8k|mv|m\/v|premiere/gi, '')
            .replace(/rotana|mazzika|melody|free\s?tv/gi, '') // Common Arabic record labels
            .replace(/prod(\.)?\s?by.*?$/gi, '') // Remove producer credits
            .replace(/ft\.|feat\..*?$/gi, '') // Optional: remove features for better search match
            .replace(/\|/g, ' ') // Replace pipe with space
            .replace(/\s{2,}/g, ' ') // Collapse multiple spaces
            .trim();
    }

    /**
     * Checks if a search result matches the track using fuzzy matching
     */
    isMatch(track, result) {
        if (!track || !result) return false;

        const trackTitle = this.cleanTrackTitle(track.title).toLowerCase();
        const resultTitle = this.cleanTrackTitle(result.title || result.trackName || '').toLowerCase();

        // High similarity requirement for title
        const titleSimilarity = this.getSimilarity(trackTitle, resultTitle);
        if (titleSimilarity > 0.8) return true;

        // If title match is decent, check artist too
        if (titleSimilarity > 0.5) {
            const trackArtist = (track.artist || track.uploader || '').replace(/\s-\sTopic$/, '').toLowerCase();
            const resultArtist = (result.artist || result.artistName || '').toLowerCase();

            if (trackArtist && resultArtist) {
                const artistSimilarity = this.getSimilarity(trackArtist, resultArtist);
                return artistSimilarity > 0.6;
            }
        }

        return false;
    }

    /**
     * Simple Levenshtein-based similarity
     */
    getSimilarity(s1, s2) {
        if (!s1 || !s2) return 0;
        if (s1 === s2) return 1.0;

        // If one contains the other, it's a strong signal
        if (s1.includes(s2) || s2.includes(s1)) {
            const shorterLen = Math.min(s1.length, s2.length);
            const longerLen = Math.max(s1.length, s2.length);
            if (shorterLen / longerLen > 0.7) return 0.9;
        }

        const longer = s1.length > s2.length ? s1 : s2;
        const shorter = s1.length > s2.length ? s2 : s1;
        const longerLength = longer.length;

        if (longerLength === 0) return 1.0;

        const editDistance = this.levenshteinDistance(longer, shorter);
        return (longerLength - editDistance) / longerLength;
    }

    levenshteinDistance(s1, s2) {
        const costs = [];
        for (let i = 0; i <= s1.length; i++) {
            let lastValue = i;
            for (let j = 0; j <= s2.length; j++) {
                if (i === 0) costs[j] = j;
                else {
                    if (j > 0) {
                        let newValue = costs[j - 1];
                        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
                            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                        }
                        costs[j - 1] = lastValue;
                        lastValue = newValue;
                    }
                }
            }
            if (i > 0) costs[s2.length] = lastValue;
        }
        return costs[s2.length];
    }

    /**
     * Build lyrics data object with sync support
     */
    buildLyricsData(track, data = {}) {
        const synced = data.synced ?? null;
        let parsed = null;

        if (synced) {
            console.log(`⚙️ Parsing synced lyrics for: ${track.title}`);
            parsed = this.parseLrc(synced);
            if (parsed) {
                console.log(`✅ Successfully parsed ${parsed.length} timed lines.`);
            } else {
                console.log(`⚠️ Synced lyrics found but failed to parse into timed lines.`);
            }
        }

        return {
            plain: data.plain ?? null,
            synced: synced,
            parsed: parsed,
            source: data.source ?? null,
            artist: data.artist ?? track?.artist ?? track?.uploader ?? null,
            title: data.title ?? track?.title ?? null,
            album: data.album ?? null
        };
    }

    /**
     * Parses LRC format [mm:ss.xx] text
     */
    parseLrc(lrc) {
        if (!lrc) return null;
        const lines = lrc.split('\n');
        const parsed = [];

        for (const line of lines) {
            // Updated regex to support both [mm:ss.xx] and [mm:ss]
            const match = line.match(/\[(\d+):(\d+(?:\.\d+)?)\](.*)/);
            if (match) {
                const minutes = parseInt(match[1]);
                const seconds = parseFloat(match[2]);
                const time = (minutes * 60 + seconds) * 1000;
                const text = match[3].trim();
                // Skip metadata lines like [ti:Title] which won't match the new regex anyway
                if (text) {
                    parsed.push({ time, text });
                }
            }
        }

        return parsed.length > 0 ? parsed : null;
    }

    /**
     * Gets the lyric line for a specific time in ms
     */
    getLyricAtTime(lyricsData, timeMs) {
        if (!lyricsData || !lyricsData.parsed) return null;

        const lines = lyricsData.parsed;
        let currentLine = null;

        for (let i = 0; i < lines.length; i++) {
            if (timeMs >= lines[i].time) {
                currentLine = lines[i].text;
            } else {
                break; // Lines are ordered by time
            }
        }

        return currentLine;
    }

    /**
     * Fetch lyrics - first from LRCLIB for sync, fallback to Genius
     */
    async fetchLyrics(track) {
        if (!track || !track.title) return null;

        const cacheKey = this.getCacheKey(track);

        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        console.log(`🔍 Searching lyrics for: ${track.title} - ${track.artist || track.uploader}`);

        // Try LRCLIB first for synced support
        const lrclibResult = await this.fetchFromLrclib(track);
        if (lrclibResult && (lrclibResult.synced || lrclibResult.plain)) {
            console.log(`✅ Lyrics found on LRCLIB (${lrclibResult.synced ? 'synced' : 'plain'})`);
            this.storeInCache(cacheKey, lrclibResult);
            return lrclibResult;
        }

        // Fallback to Genius
        const geniusResult = await this.fetchFromGenius(track);
        if (geniusResult && geniusResult.plain) {
            console.log(`✅ Lyrics found on Genius (plain)`);
            this.storeInCache(cacheKey, geniusResult);
            return geniusResult;
        }

        console.log(`❌ No lyrics found for: ${track.title}`);
        // Cache null result to avoid repeated lookups
        this.storeInCache(cacheKey, null);
        return null;
    }

    async fetchFromLrclib(track) {
        try {
            const artist = (track.artist || track.uploader || '').replace(/\s-\sTopic$/, '').trim();
            const searchUrl = 'https://lrclib.net/api/search';
            const cleanTitle = this.cleanTrackTitle(track.title || '');

            const attempts = [];

            // Attempt 1: Specific names (most accurate)
            if (artist && cleanTitle) {
                attempts.push({ track_name: cleanTitle, artist_name: artist });
            }

            // Attempt 2: Search query with artist and title
            attempts.push({ q: `${artist} ${cleanTitle}`.trim() });

            // Attempt 3: If title has separators like "-" or "|", try parts individually
            // This helpful for bilingual titles common in Arabic songs
            if (cleanTitle.includes('-') || cleanTitle.includes('|')) {
                const parts = cleanTitle.split(/[-|]/).map(p => p.trim()).filter(p => p.length > 5);
                for (const part of parts) {
                    attempts.push({ q: part });
                }
            }

            // Attempt 4: Just the clean title
            attempts.push({ q: cleanTitle });

            // Attempt 5: Original title (no cleaning)
            if (track.title !== cleanTitle) {
                attempts.push({ q: track.title });
            }

            for (let i = 0; i < attempts.length; i++) {
                const params = attempts[i];
                if (!params.q && !params.track_name) continue;

                try {
                    const response = await axios.get(searchUrl, {
                        params,
                        timeout: 5000
                    });

                    if (response.data && response.data.length > 0) {
                        // Find the first result that matches the track and has lyrics
                        const result = response.data.find(r => (r.plainLyrics || r.syncedLyrics) && this.isMatch(track, r));

                        if (result) {
                            return this.buildLyricsData(track, {
                                plain: result.plainLyrics,
                                synced: result.syncedLyrics,
                                source: 'LRCLIB'
                            });
                        }
                    }
                } catch (error) {
                    // Continue to next attempt
                }
            }

            return null;
        } catch (error) {
            console.error('❌ Failed to fetch lyrics from LRCLIB:', error.message);
            return null;
        }
    }


    async fetchFromGenius(track) {
        try {
            const artist = (track.artist || track.uploader || '').replace(/\s-\sTopic$/, '').trim();
            const cleanTitle = this.cleanTrackTitle(track.title || '');

            if (!cleanTitle) return null;

            const queries = [];
            queries.push(`${artist} ${cleanTitle}`);
            queries.push(cleanTitle);

            // Handle bilingual/split titles for Genius too
            if (cleanTitle.includes('-') || cleanTitle.includes('|')) {
                const parts = cleanTitle.split(/[-|]/).map(p => p.trim()).filter(p => p.length > 5);
                for (const part of parts) {
                    queries.push(part);
                    if (artist) queries.push(`${artist} ${part}`);
                }
            }

            for (const query of queries) {
                try {
                    const searches = await this.geniusClient.songs.search(query);
                    if (!searches || searches.length === 0) continue;

                    // Find the first search result that matches the track
                    const matchingSong = searches.find(s => this.isMatch(track, s));
                    if (!matchingSong) continue;

                    const lyrics = await matchingSong.lyrics();
                    if (!lyrics) continue;

                    const cleanedLyrics = this.cleanGeniusLyrics(lyrics);
                    if (!cleanedLyrics) continue;

                    return this.buildLyricsData(track, {
                        plain: cleanedLyrics,
                        source: 'Genius'
                    });
                } catch (err) {
                    // Try next query
                }
            }

            return null;
        } catch (error) {
            console.error('❌ Failed to fetch lyrics from Genius:', error.message);
            return null;
        }
    }

    cleanGeniusLyrics(lyrics) {
        if (!lyrics) return null;

        let cleaned = lyrics;

        // Step 1: Remove contributor/translation header (everything before actual lyrics start)
        // Match: "131 Contributors...Lyrics" or "131 Contributors...Lyrics<img...>"
        cleaned = cleaned.replace(/^\d+\s+Contributors.*?Lyrics(<[^>]+>)*\s*/is, '');

        // Step 2: Remove HTML tags
        cleaned = cleaned.replace(/<[^>]*>/g, '');

        // Step 3: Remove description paragraphs (usually before [Verse] tags)
        // Match lines that end with "..." and "Read More"
        cleaned = cleaned.replace(/^[^\[]+?\.{3}\s*Read More\s*/im, '');

        // Step 4: Remove bracketed descriptions with quotes (like ["Susamam" ft. ...])
        cleaned = cleaned.replace(/\[[""][^\]]{50,}\]/g, '');

        // Step 5: Clean up whitespace
        cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
        cleaned = cleaned.trim();

        return cleaned || null;
    }



    /**
     * Format full lyrics for display (with pagination support)
     * @param {Object} lyricsData - Lyrics data
     * @param {number} maxLength - Max character length per page
     * @returns {Array<string>} Array of lyric pages
     */
    formatFullLyrics(lyricsData, maxLength = 4000) {
        if (!lyricsData) return [];

        const text = lyricsData.plain || lyricsData.synced?.replace(/\[\d+:\d+\.\d+\]/g, '') || '';
        if (!text) return [];

        const pages = [];
        const lines = text.split('\n').filter(line => line.trim());

        let currentPage = '';
        for (const line of lines) {
            if ((currentPage + line + '\n').length > maxLength) {
                if (currentPage) pages.push(currentPage.trim());
                currentPage = line + '\n';
            } else {
                currentPage += line + '\n';
            }
        }

        if (currentPage) pages.push(currentPage.trim());

        return pages;
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
        for (const timer of this.cacheTimers.values()) {
            clearTimeout(timer);
        }
        this.cacheTimers.clear();
    }
}

module.exports = new LyricsManager();
