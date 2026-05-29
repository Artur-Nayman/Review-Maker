require('dotenv').config();
const { Client, GatewayIntentBits, Collection, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { getReviewerByDiscordId, loadData, saveData, determineReviewSize } = require('./utils/data');
const { approveReview, disapproveReview, getReviewById, incrementReviewerLoads } = require('./utils/reviews');
const { createReviewEmbed, createErrorEmbed, createSuccessEmbed, getReviewerMention } = require('./utils/embeds');

const simpleGit = require('simple-git');
const git = simpleGit(path.join(__dirname, '..'));

let isGitBusy = false;

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

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

client.on('clientReady', async () => {
  const db = require('../server/db');
  try {
    await db.init();
  } catch (e) {
    console.error('[DB] Init failed:', e.message);
  }

  console.log(`Logged in as ${client.user.tag}`);
  try {
    const guilds = await client.guilds.fetch();
    console.log(`Bot is in ${guilds.size} servers`);
  } catch (e) {
    console.error('Failed to fetch guilds:', e.message);
  }

  // Auto-pull with safety check
  async function autoPull() {
    if (isGitBusy) {
      console.log('[Auto-Pull] Skipped — git in use');
      return;
    }
    isGitBusy = true;
    try {
      await withTimeout(git.pull('origin', (await git.branch()).current));
      console.log('[Auto-Pull] Synced with GitHub');
    } catch (err) {
      console.error('[Auto-Pull] Pull failed:', err.message);
    } finally {
      isGitBusy = false;
    }
  }
  autoPull();
  setInterval(autoPull, 5 * 60 * 1000);
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

  const num = data.settings.nextReviewNumber || 1;
  data.settings.nextReviewNumber = num + 1;
  const reviewId = `REV-${num}`;

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

const TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!TOKEN) {
  console.error('Error: DISCORD_BOT_TOKEN environment variable is not set.');
  console.error('Create a .env file or set the variable before running the bot.');
  process.exit(1);
}

client.login(TOKEN);
