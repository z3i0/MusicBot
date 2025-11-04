const { EmbedBuilder } = require("discord.js");

module.exports = {
    name: "ping",
    description: "Shows the bot's response speed",
    async execute(message, args, client) {
        // Send a temporary message to calculate latency
        const sent = await message.reply("🏓 Calculating ping...");

        // Calculate latencies
        const messageLatency = sent.createdTimestamp - message.createdTimestamp;
        const apiLatency = Math.round(client.ws.ping);

        // Create a professional embed
        const embed = new EmbedBuilder()
            .setColor("Aqua")
            .setTitle("🏓 Pong!")
            .addFields(
                { name: "📶 Message Latency", value: `\`${messageLatency}ms\``, inline: true },
                { name: "⚙️ API Latency", value: `\`${apiLatency}ms\``, inline: true }
            )
            .setFooter({
                text: `Requested by ${message.author.tag}`,
                iconURL: message.author.displayAvatarURL(),
            })
            .setTimestamp();

        // Edit the temporary message with the results
        await sent.edit({ content: "", embeds: [embed] });
    },
};