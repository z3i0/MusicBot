require("dotenv").config();
const path = require("path");
const chalk = require("chalk");
const { Bot, BotChannel } = require("./models");
const runSingleBot = require("./single-bot-runner");

const activeClients = new Map();

async function startBot(botRow) {
  try {
    console.log(chalk.cyan(`[Supervisor] Launching bot: ${botRow.slug}...`));
    const client = await runSingleBot(botRow);
    if (client) {
      activeClients.set(botRow.slug, client);
      console.log(chalk.green(`🟢 Bot ${botRow.slug} is online (integrated mode)`));
    } else {
      console.log(chalk.yellow(`ℹ️ Bot ${botRow.slug} skipped (missing token or disabled).`));
    }
  } catch (error) {
    console.error(chalk.red(`❌ Failed to start bot ${botRow.slug}:`), error);
  }
}

// Graceful shutdown handling
async function gracefulShutdown(signal) {
  console.log(chalk.yellow(`\nReceived ${signal}. Gracefully shutting down all bots...`));
  for (const [slug, client] of activeClients.entries()) {
    try {
      if (client.players) {
        for (const player of client.players.values()) {
          try {
            player.cleanup?.();
          } catch (e) {}
        }
      }
      client.destroy();
      console.log(chalk.gray(`Stopped bot: ${slug}`));
    } catch (err) {
      // ignore individual destroy errors
    }
  }
  process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

(async () => {
  console.log(chalk.bold.blue("🚀 Starting Unified Multi-Bot System (Single Process Mode)..."));

  const bots = await Bot.findAll({
    where: { status: "active" },
    include: { model: BotChannel, as: "channels" },
  });

  if (!bots.length) {
    console.log(chalk.yellow("⚠️ No active bots found in database."));
    return;
  }

  console.log(chalk.blue(`Found ${bots.length} active bot(s). Launching sequentially in-memory...`));

  for (const botRow of bots) {
    await startBot(botRow);
    // Stagger logins by 400ms to avoid Discord gateway rate limits
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  console.log(chalk.green.bold(`✅ All active bots initialized. Running: ${activeClients.size}/${bots.length}`));
})();