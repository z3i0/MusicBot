require("dotenv").config();
const loadBots = require("./multi-bot-loader");

(async () => {
  console.log("🚀 Starting Multi-Bot System...");

  const clients = await loadBots();
  console.log(`🟢 Loaded ${clients.length} bots.`);
})();