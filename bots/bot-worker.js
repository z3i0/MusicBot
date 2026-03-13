// bots/bot-worker.js
const runSingleBot = require("../single-bot-runner");

process.on("message", async (botRow) => {
  try {
    console.log(`[Worker] Starting bot: ${botRow.slug}`);

    const client = await runSingleBot(botRow);

    if (client) {
      process.send?.({ type: "online", slug: botRow.slug });
    } else {
      process.exit(0); // Exit cleanly if bot couldn't start (e.g. missing token)
    }
  } catch (error) {
    console.error(`[Worker] Bot ${botRow.slug} crashed:`, error);
    process.exit(1);
  }
});