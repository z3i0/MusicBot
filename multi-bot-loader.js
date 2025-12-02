const { Bot, BotChannel } = require("./models");
const runSingleBot = require("./single-bot-runner");

module.exports = async function loadBots() {
  const bots = await Bot.findAll({
    where: { status: "active" },
    include: { model: BotChannel, as: "channels" }
  });

  const clients = [];

  for (const bot of bots) {
    const client = await runSingleBot(bot);
    if (client) clients.push(client);
  }

  return clients;
};