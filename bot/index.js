require('dotenv').config();
const { Client, GatewayIntentBits, Collection, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { getReviewerByDiscordId, loadData, saveData, determineReviewSize, generateReviewId } = require('./utils/data');
const { approveReview, disapproveReview, getReviewById, incrementReviewerLoads, selectReviewers } = require('./utils/reviews');
const { createReviewEmbed, createErrorEmbed, createSuccessEmbed, getReviewerMention } = require('./utils/embeds');

const { exec: execCb } = require('child_process');
const { promisify } = require('util');
const exec = promisify(execCb);

const simpleGit = require('simple-git');
const projectRoot = path.join(__dirname, '..');
const git = simpleGit(projectRoot);

// Check if git is available and repo exists
let gitAvailable = false;
(async () => {
  try {
    await fs.promises.access(path.join(projectRoot, '.git'));
    gitAvailable = true;
  } catch { /* no git repo */ }
})();

let isGitBusy = false;

// Crash logger — writes to logs/crash.log
const LOG_DIR = path.join(projectRoot, 'logs');
function logCrash(message) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const timestamp = new Date().toISOString();
    fs.appendFileSync(path.join(LOG_DIR, 'crash.log'), `[${timestamp}] ${message}\n`);
  } catch { /* best effort */ }
}

process.on('unhandledRejection', (reason, promise) => {
  const msg = `Unhandled Rejection: ${reason instanceof Error ? reason.message : reason}${reason instanceof Error && reason.stack ? '\n' + reason.stack : ''}`;
  console.error('[FATAL]', msg);
  logCrash(msg);
});

process.on('uncaughtException', (err, origin) => {
  const msg = `Uncaught Exception: ${err.message} (origin: ${origin})${err.stack ? '\n' + err.stack : ''}`;
  console.error('[FATAL]', msg);
  logCrash(msg);
  process.exit(1);
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.health = {
  startedAt: Date.now(),
  discord: { status: 'connecting', lastReady: null, lastDisconnect: null, ping: 0 },
  sheets: { status: 'disabled', lastCheck: null, lastError: null },
  db: { status: 'unknown', lastCheck: null, lastError: null },
  git: { lastPull: null, lastPullResult: null }
};

client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
  } else {
    console.log(`[WARNING] The command at ${file} is missing required properties.`);
  }
}

function withTimeout(promise, ms = 30000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Git operation timed out after ${ms}ms`)), ms))
  ]);
}

client.on('shardReady', (id) => {
  client.health.discord.status = 'connected';
  client.health.discord.lastReady = Date.now();
  console.log(`[Health] Shard ${id} ready`);
});

client.on('shardDisconnect', (event, id) => {
  client.health.discord.status = 'disconnected';
  client.health.discord.lastDisconnect = Date.now();
  console.log(`[Health] Shard ${id} disconnected — close code: ${event.code}`);
});

client.on('shardReconnecting', (id) => {
  client.health.discord.status = 'reconnecting';
  console.log(`[Health] Shard ${id} reconnecting...`);
});

client.on('shardResume', (replayed, id) => {
  client.health.discord.status = 'connected';
  client.health.discord.lastReady = Date.now();
  console.log(`[Health] Shard ${id} resumed (${replayed} events replayed)`);
});

client.on('clientReady', async () => {
  const db = require('../server/db');
  try {
    await db.init();
  } catch (e) {
    console.error('[DB] Init failed:', e.message);
  }

  db.bootstrapAdmins();

  // Auto-start Tailscale SSH for remote access
  try {
    const { stdout } = await exec(
      'if command -v tailscale >/dev/null 2>&1; then ' +
      '  tailscale up --ssh 2>&1; ' +
      'elif command -v pkg >/dev/null 2>&1; then ' +
      '  echo "[Tailscale] installing via pkg..." && pkg install tailscale -y >/dev/null 2>&1 && tailscale up --ssh 2>&1; ' +
      'else ' +
      '  am start -n com.tailscale.ipn/.App >/dev/null 2>&1 || true; ' +
      'fi'
    );
    if (stdout.trim()) console.log('[Tailscale]', stdout.trim());
  } catch {} // ponytail: all paths fail silently

  console.log(`Logged in as ${client.user.tag}`);

  // Auto-deploy slash commands on every start
  try {
    const { stdout, stderr } = await withTimeout(
      exec('node bot/deploy-commands.js', { cwd: path.join(__dirname, '..') }),
      30000
    );
    if (stdout) console.log('[Deploy]', stdout.trim());
    if (stderr) console.error('[Deploy]', stderr.trim());
  } catch (err) {
    console.error('[Deploy] Failed:', err.message);
  }

  try {
    const guilds = await client.guilds.fetch();
    console.log(`Bot is in ${guilds.size} servers`);
  } catch (e) {
    console.error('Failed to fetch guilds:', e.message);
  }

  // Auto-pull with safety check
  async function autoPull() {
    if (!gitAvailable) {
      return;
    }
    if (isGitBusy) {
      console.log('[Auto-Pull] Skipped — git in use');
      return;
    }
    isGitBusy = true;
    try {
      const pullResult = await withTimeout(git.pull('origin', (await git.branch()).current));
      client.health.git.lastPull = Date.now();
      if (pullResult && pullResult.summary && pullResult.summary.changes > 0) {
        client.health.git.lastPullResult = `${pullResult.summary.changes} file(s) updated`;
        console.log(`[Auto-Pull] ${pullResult.summary.changes} file(s) changed — running npm install...`);
        try {
          await withTimeout(exec('npm install --no-audit --no-fund', { cwd: path.join(__dirname, '..') }), 120000);
          console.log('[Auto-Pull] npm install complete');
          console.log('[Auto-Pull] Restarting to apply update...');
          process.exit(0);
        } catch (err) {
          console.error('[Auto-Pull] npm install failed:', err.message);
          console.log('[Auto-Pull] Deferred restart — npm install will retry on next cycle');
        }
      } else {
        client.health.git.lastPullResult = 'up to date';
        console.log('[Auto-Pull] Already up to date');
      }
    } catch (err) {
      client.health.git.lastPull = Date.now();
      client.health.git.lastPullResult = 'error: ' + err.message;
      console.error('[Auto-Pull] Pull failed:', err.message);
      if (err.git) {
        console.error('[Auto-Pull] Git error details:', err.git);
      }
    } finally {
      isGitBusy = false;
    }
  }
  autoPull();
  setInterval(autoPull, 5 * 60 * 1000);

  // Weekly restart to prevent memory leaks
  const MS_WEEK = 7 * 24 * 60 * 60 * 1000;
  setTimeout(() => {
    console.log('[Auto-Pull] Weekly scheduled restart');
    process.exit(0);
  }, MS_WEEK);

  async function checkDatabase() {
    try {
      const db = require('../server/db');
      await db.init();
      const data = db.loadData();
      if (data && data.reviewers) {
        client.health.db.status = 'ok';
        client.health.db.lastCheck = Date.now();
        client.health.db.lastError = null;
        console.log('[Health] Database: OK');
      } else {
        throw new Error('Invalid data structure');
      }
    } catch (err) {
      client.health.db.status = 'error';
      client.health.db.lastCheck = Date.now();
      client.health.db.lastError = err.message;
      console.error('[Health] Database check failed:', err.message);
    }
  }

  checkDatabase();
  setInterval(checkDatabase, 30 * 60 * 1000);
  setInterval(() => { client.health.discord.ping = client.ws.ping; }, 60 * 1000);

  startCleanupChecker();
});

client.on('interactionCreate', async interaction => {
  if (interaction.isButton()) {
    return handleButton(interaction);
  }

  if (interaction.isStringSelectMenu()) {
    return handleSelectMenu(interaction);
  }

  if (interaction.isModalSubmit()) {
    return handleModal(interaction);
  }

  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    const reply = {
      content: 'There was an error executing this command!',
      ephemeral: true
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

async function handleButton(interaction) {
  if (interaction.customId === 'link-register') {
    return handleLinkRegister(interaction);
  }

  if (interaction.customId.startsWith('cleanup-')) {
    return handleCleanupButton(interaction);
  }

  const firstUnderscore = interaction.customId.indexOf('_');
  const action = interaction.customId.slice(0, firstUnderscore);
  const reviewId = interaction.customId.slice(firstUnderscore + 1);

  if (action !== 'approve' && action !== 'reject') return;

  const data = loadData();
  const reviewer = getReviewerByDiscordId(data, interaction.user.id);

  if (!reviewer) {
    return interaction.reply({
      content: 'Please link your Discord account first using `/link`.',
      ephemeral: true
    });
  }

  const review = getReviewById(reviewId);
  if (!review) {
    return interaction.reply({ embeds: [createErrorEmbed('Review not found')], ephemeral: true });
  }

  const myReviewer = review.reviewers.find(r => r.name.toLowerCase() === reviewer.name.toLowerCase());
  if (!myReviewer || myReviewer.status !== 'pending') {
    return interaction.reply({ embeds: [createErrorEmbed('You have already responded to this review')], ephemeral: true });
  }

  if (action === 'approve') {
    try {
      const updated = approveReview(reviewId, reviewer.name);
      const embed = createReviewEmbed(updated);

      const mergerMention = getReviewerMention(updated.merger);
      let notifyText;
      if (updated.status === 'approved') {
        notifyText = `${mergerMention} — your review **${updated.branch}** has been fully approved! ✅`;
      } else {
        notifyText = `${mergerMention} — ${reviewer.name} approved your review **${updated.branch}** (${updated.approvalCount}/${updated.reviewers.length})`;
      }

      await interaction.reply({ content: notifyText, embeds: [embed] });
    } catch (err) {
      await interaction.reply({ embeds: [createErrorEmbed(err.message)], ephemeral: true });
    }
  } else if (action === 'reject') {
    const modal = new ModalBuilder()
      .setCustomId(`reject-modal_${reviewId}`)
      .setTitle('Reject Review');

    const commentInput = new TextInputBuilder()
      .setCustomId('comment')
      .setLabel('Reason for rejection')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    const row = new ActionRowBuilder().addComponents(commentInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
  }
}

async function handleSelectMenu(interaction) {
  if (interaction.customId === 'link-select') {
    return handleLinkSelect(interaction);
  }

  if (interaction.customId.startsWith('fixdone-notify_')) {
    return handleFixDoneNotify(interaction);
  }

  if (interaction.customId.startsWith('manual-review_')) {
    return handleManualReview(interaction);
  }
}

async function handleLinkSelect(interaction) {
  const data = loadData();
  const selectedName = interaction.values[0];
  const reviewer = data.reviewers.find(r => r.name === selectedName);

  if (!reviewer) {
    return interaction.update({
      content: 'Reviewer not found.',
      components: []
    });
  }

  reviewer.discordId = interaction.user.id;
  saveData(data, `${reviewer.name} linked to Discord`);

  await interaction.update({
    content: `Successfully linked to **${reviewer.name}** (${reviewer.role})`,
    components: []
  });
}

async function handleLinkRegister(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('register-modal')
    .setTitle('Register as New Reviewer');

  const nameInput = new TextInputBuilder()
    .setCustomId('name')
    .setLabel('Your name (as shown in the team)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(50);

  const specialityInput = new TextInputBuilder()
    .setCustomId('speciality')
    .setLabel('Speciality (Fullstack, Frontend, Backend)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setValue('Fullstack')
    .setMaxLength(20);

  modal.addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(specialityInput)
  );

  await interaction.showModal(modal);
}

async function handleRegisterModal(interaction) {
  const name = interaction.fields.getTextInputValue('name').trim();
  const speciality = interaction.fields.getTextInputValue('speciality').trim() || 'Fullstack';

  if (!name) {
    return interaction.reply({ content: 'Name is required.', ephemeral: true });
  }

  const data = loadData();

  if (data.reviewers.find(r => r.name.toLowerCase() === name.toLowerCase())) {
    return interaction.reply({ content: `A reviewer with name "${name}" already exists. Use the select menu to link to an existing account.`, ephemeral: true });
  }

  const existing = getReviewerByDiscordId(data, interaction.user.id);
  if (existing) {
    return interaction.reply({ content: `Your Discord is already linked to **${existing.name}**.`, ephemeral: true });
  }

  const validSpecialities = ['fullstack', 'frontend', 'backend', 'none'];
  const finalSpeciality = validSpecialities.includes(speciality.toLowerCase())
    ? speciality.charAt(0).toUpperCase() + speciality.slice(1)
    : 'Fullstack';

  data.reviewers.push({
    name,
    load: 0,
    speciality: finalSpeciality,
    role: 'reviewer',
    email: '',
    password: '',
    discordId: interaction.user.id,
    disabled: false,
    maxLoad: 0,
    weeklyCount: 0,
    maxActiveReviews: 0
  });

  saveData(data, `User ${name} self-registered via Discord`);

  await interaction.reply({
    content: `Registered and linked as **${name}** (${finalSpeciality}). You can now approve/reject reviews!`,
    ephemeral: true
  });
}

async function handleFixDoneNotify(interaction) {
  const reviewId = interaction.customId.slice('fixdone-notify_'.length);
  const selectedName = interaction.values[0];

  const review = getReviewById(reviewId);
  if (!review) {
    return interaction.update({
      content: 'Review not found.',
      components: []
    });
  }

  const mention = getReviewerMention(selectedName);
  const notifyText = mention.startsWith('<@')
    ? `${mention} — fixes are done for **${review.branch}** (${review.id}), please re-review!`
    : `${selectedName} — fixes are done for **${review.branch}** (${review.id}), please re-review!`;

  await interaction.update({
    content: notifyText,
    components: []
  });
}

async function handleManualReview(interaction) {
  const parts = interaction.customId.split('_');
  const size = parts[parts.length - 1];
  const priority = parts[parts.length - 2];
  const reviewType = parts[parts.length - 3];
  const branch = parts.slice(1, -3).join('_');

  const data = loadData();
  const selectedReviewers = interaction.values;

  const mergerReviewer = getReviewerByDiscordId(data, interaction.user.id);
  const merger = mergerReviewer ? mergerReviewer.name : 'Unknown';

  const reviewReviewers = selectedReviewers.map(name => {
    const reviewer = data.reviewers.find(r => r.name === name);
    if (reviewer) {
      reviewer.load = Math.min(reviewer.load + 1, 999);
      reviewer.weeklyCount = (reviewer.weeklyCount || 0) + 1;
      if (size === 'large') reviewer.currentLargeReview = true;
    }
    return { name, status: 'pending', notified: false };
  });

  const reviewId = generateReviewId(data);

  const review = {
    id: reviewId,
    branch,
    reviewType,
    size: size || 'medium',
    commits: [],
    merger,
    reviewers: reviewReviewers,
    approvalCount: 0,
    status: 'in_review',
    priority,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    escalation: null,
    comments: []
  };

  data.reviews.push(review);
  saveData(data, `Manual review ${review.id} created: ${branch}`);

  const embed = createReviewEmbed(review, true);
  const mentions = review.reviewers.map(rv => getReviewerMention(rv.name)).filter(m => m.startsWith('<@'));
  const mentionText = mentions.length > 0 ? `\n${mentions.join(' ')} — please review!` : '';

  await interaction.update({
    content: `Review created: **${review.id}**${mentionText}`,
    components: [],
    ephemeral: false
  });
}

async function handleModal(interaction) {
  if (interaction.customId === 'register-modal') {
    return handleRegisterModal(interaction);
  }

  if (interaction.customId.startsWith('cleanup-speciality-modal_')) {
    return handleCleanupSpecialityModal(interaction);
  }

  if (!interaction.customId.startsWith('reject-modal_')) return;

  const reviewId = interaction.customId.slice('reject-modal_'.length);
  const comment = interaction.fields.getTextInputValue('comment');

  const data = loadData();
  const reviewer = getReviewerByDiscordId(data, interaction.user.id);

  if (!reviewer) {
    return interaction.reply({
      content: 'Please link your Discord account first using `/link`.',
      ephemeral: true
    });
  }

  try {
    const updated = disapproveReview(reviewId, reviewer.name, comment);
    const embed = createReviewEmbed(updated);

    const mergerMention = getReviewerMention(updated.merger);
    const notifyText = `${mergerMention} — ${reviewer.name} rejected your review **${updated.branch}**:\n> ${comment}`;

    await interaction.reply({ content: notifyText, embeds: [embed] });
  } catch (err) {
    await interaction.reply({ embeds: [createErrorEmbed(err.message)], ephemeral: true });
  }
}

// ===== CLEANUP CAMPAIGN HANDLERS =====

// Reassign pending reviews from a leaving/disabled reviewer and reset their load
function reassignReviewsAndClearLoad(data, reviewerName) {
  let count = 0;
  for (const review of data.reviews) {
    if (review.status !== 'in_review' && review.status !== 'fix_made') continue;
    const entry = review.reviewers.find(r => r.name === reviewerName && r.status === 'pending');
    if (!entry) continue;
    const assignedNames = review.reviewers.map(r => r.name);
    const replacements = selectReviewers(data, review.reviewType, 1, review.merger);
    const available = replacements.filter(r => !assignedNames.includes(r.name));
    if (available.length > 0) {
      const replacement = available[0];
      review.reviewers = review.reviewers.filter(r => r.name !== reviewerName);
      review.reviewers.push({ name: replacement.name, status: 'pending', notified: false });
      const replacementReviewer = data.reviewers.find(r => r.name === replacement.name);
      if (replacementReviewer) replacementReviewer.load = Math.min(replacementReviewer.load + 1, data.settings.maxLoad || 3);
      count++;
    } else {
      review.reviewers = review.reviewers.filter(r => r.name !== reviewerName);
    }
  }
  const reviewer = data.reviewers.find(r => r.name === reviewerName);
  if (reviewer) reviewer.load = 0;
  return count;
}

async function handleCleanupButton(interaction) {
  const parts = interaction.customId.split('_');
  const action = parts[0]; // cleanup-staying, cleanup-leaving, cleanup-speciality, cleanup-respond

  // "Respond" button — shows ephemeral per-user buttons
  if (action === 'cleanup-respond') {
    const { loadCleanupData } = require('./../server/db');
    const cleanup = loadCleanupData();
    const campaign = cleanup.campaigns[cleanup.campaigns.length - 1];
    const entry = campaign?.entries.find(e => e.discordId === interaction.user.id);
    if (!entry) {
      return interaction.reply({ content: 'You are not part of this cleanup campaign.', ephemeral: true });
    }
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`cleanup-staying_${entry.name}`).setLabel("✅ I'm staying").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`cleanup-leaving_${entry.name}`).setLabel("🚪 I'm leaving").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`cleanup-speciality_${entry.name}`).setLabel('🔄 Change speciality').setStyle(ButtonStyle.Secondary)
    );
    return interaction.reply({
      content: `📋 **Reviewer Cleanup** — Hello ${entry.name}\nThe admin is cleaning up the reviewer list. Please respond within **7 days** or you will be automatically disabled.`,
      components: [row],
      ephemeral: true
    });
  }
  const name = parts.slice(1).join('_');

  const data = loadData();
  const reviewer = data.reviewers.find(r => r.name.toLowerCase() === name.toLowerCase());
  if (!reviewer || reviewer.discordId !== interaction.user.id) {
    return interaction.reply({ content: 'This button is not for you.', ephemeral: true });
  }

  const { loadCleanupData, saveCleanupData } = require('./../server/db');
  const cleanup = loadCleanupData();
  const campaign = cleanup.campaigns[cleanup.campaigns.length - 1];
  const entry = campaign?.entries.find(e => e.name.toLowerCase() === name.toLowerCase());

  if (!entry) {
    return interaction.reply({ content: 'Cleanup entry not found.', ephemeral: true });
  }

  if (action === 'cleanup-staying') {
    entry.status = 'staying';
    entry.respondedAt = new Date().toISOString();
    saveCleanupData(cleanup);
    return interaction.reply({ content: '✅ Thanks! You\'re marked as staying.', ephemeral: true });
  }

  if (action === 'cleanup-leaving') {
    entry.status = 'leaving';
    entry.respondedAt = new Date().toISOString();
    const reassignedCount = reassignReviewsAndClearLoad(data, reviewer.name);
    // Delete reviewer completely
    data.reviewers = data.reviewers.filter(r => r.name !== reviewer.name);
    saveData(data, `${reviewer.name} removed via cleanup campaign (${reassignedCount} reviews reassigned)`);
    saveCleanupData(cleanup);
    return interaction.reply({
      content: `You've been removed from the reviewer list. ${reassignedCount > 0 ? `${reassignedCount} review(s) were reassigned.` : ''} Use \`/link\` to re-register if this was a mistake.`,
      ephemeral: true
    });
  }

  if (action === 'cleanup-speciality') {
    const modal = new ModalBuilder()
      .setCustomId(`cleanup-speciality-modal_${name}`)
      .setTitle('Change Speciality');

    const specialityInput = new TextInputBuilder()
      .setCustomId('speciality')
      .setLabel('New speciality (Fullstack, Frontend, Backend, None)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(20);

    modal.addComponents(new ActionRowBuilder().addComponents(specialityInput));
    return interaction.showModal(modal);
  }
}

async function handleCleanupSpecialityModal(interaction) {
  const name = interaction.customId.slice('cleanup-speciality-modal_'.length);
  const newSpeciality = interaction.fields.getTextInputValue('speciality').trim();

  const valid = ['fullstack', 'frontend', 'backend', 'none'];
  const finalSpeciality = valid.includes(newSpeciality.toLowerCase())
    ? newSpeciality.charAt(0).toUpperCase() + newSpeciality.slice(1)
    : 'Fullstack';

  const data = loadData();
  const reviewer = data.reviewers.find(r => r.name.toLowerCase() === name.toLowerCase());
  if (!reviewer) {
    return interaction.reply({ content: 'Reviewer not found.', ephemeral: true });
  }

  reviewer.speciality = finalSpeciality;
  saveData(data, `${reviewer.name} changed speciality to ${finalSpeciality} via cleanup`);

  const { loadCleanupData, saveCleanupData } = require('./../server/db');
  const cleanup = loadCleanupData();
  const campaign = cleanup.campaigns[cleanup.campaigns.length - 1];
  const entry = campaign?.entries.find(e => e.name.toLowerCase() === name.toLowerCase());
  if (entry) {
    entry.status = 'changed';
    entry.newSpeciality = finalSpeciality;
    entry.respondedAt = new Date().toISOString();
    saveCleanupData(cleanup);
  }

  return interaction.reply({ content: `✅ Your speciality has been changed to **${finalSpeciality}**.`, ephemeral: true });
}

// Also start the cleanup checker from clientReady
function startCleanupChecker() {
  async function cleanupCheck() {
    const data = loadData();
    const { loadCleanupData, saveCleanupData } = require('./../server/db');
    const cleanup = loadCleanupData();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    let changed = false;

    for (const campaign of cleanup.campaigns) {
      const campaignStart = new Date(campaign.startedAt).getTime();
      for (const entry of campaign.entries) {
        if (entry.status === 'pending' && Date.now() - campaignStart >= sevenDays) {
          const reviewer = data.reviewers.find(r => r.name === entry.name);
          if (reviewer) {
            const reassigned = reassignReviewsAndClearLoad(data, reviewer.name);
            data.reviewers = data.reviewers.filter(r => r.name !== reviewer.name);
            entry.status = `auto_removed (${reassigned} reviews reassigned)`;
            changed = true;
          }
          entry.respondedAt = new Date().toISOString();
        }
      }
    }

    if (changed) {
      saveData(data, 'Cleanup campaign: auto-removed inactive reviewers');
    }
    saveCleanupData(cleanup);
  }

  cleanupCheck();
  setInterval(cleanupCheck, 60 * 60 * 1000);
}

const TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!TOKEN) {
  console.error('Error: DISCORD_BOT_TOKEN environment variable is not set.');
  console.error('Create a .env file or set the variable before running the bot.');
  process.exit(1);
}

client.login(TOKEN);
