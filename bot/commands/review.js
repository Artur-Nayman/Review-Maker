const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { getReviewerByDiscordId, loadData } = require('../utils/data');
const {
  createReview,
  approveReview,
  disapproveReview,
  markFixDone,
  escalateReview,
  escalationDecide,
  addComment,
  getActiveReviews,
  getReviewById
} = require('../utils/reviews');
const { createReviewEmbed, createActiveReviewsEmbed, createErrorEmbed, createSuccessEmbed, getReviewerMention } = require('../utils/embeds');

const sizeChoices = [
  { name: 'Auto (based on commits)', value: 'auto' },
  { name: 'Small', value: 'small' },
  { name: 'Medium', value: 'medium' },
  { name: 'Large', value: 'large' }
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('review')
    .setDescription('Review management commands')
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('Create a new branch review (auto-assign reviewers)')
        .addStringOption(opt => opt.setName('branch').setDescription('Branch name').setRequired(true))
        .addStringOption(opt => opt.setName('type').setDescription('Review type').setRequired(true).addChoices(
          { name: 'Frontend', value: 'frontend' },
          { name: 'Backend', value: 'backend' },
          { name: 'Fullstack', value: 'fullstack' }
        ))
        .addStringOption(opt => opt.setName('priority').setDescription('Priority').setRequired(true).addChoices(
          { name: 'Low', value: 'low' },
          { name: 'Mid', value: 'mid' },
          { name: 'Important', value: 'imp' }
        ))
        .addStringOption(opt => opt.setName('size').setDescription('Review size (default: auto)').addChoices(...sizeChoices))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('create-commit')
        .setDescription('Create a commit-based review (1-3 commits, auto-assign)')
        .addStringOption(opt => opt.setName('branch').setDescription('Source branch').setRequired(true))
        .addStringOption(opt => opt.setName('commits').setDescription('Commit hashes, comma-separated (1-3)').setRequired(true))
        .addStringOption(opt => opt.setName('type').setDescription('Review type').setRequired(true).addChoices(
          { name: 'Frontend', value: 'frontend' },
          { name: 'Backend', value: 'backend' },
          { name: 'Fullstack', value: 'fullstack' }
        ))
        .addStringOption(opt => opt.setName('priority').setDescription('Priority').setRequired(true).addChoices(
          { name: 'Low', value: 'low' },
          { name: 'Mid', value: 'mid' },
          { name: 'Important', value: 'imp' }
        ))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('create-manual')
        .setDescription('Create a review with specific reviewers (admin only)')
        .addStringOption(opt => opt.setName('branch').setDescription('Branch name').setRequired(true))
        .addStringOption(opt => opt.setName('type').setDescription('Review type').setRequired(true).addChoices(
          { name: 'Frontend', value: 'frontend' },
          { name: 'Backend', value: 'backend' },
          { name: 'Fullstack', value: 'fullstack' }
        ))
        .addStringOption(opt => opt.setName('priority').setDescription('Priority').setRequired(true).addChoices(
          { name: 'Low', value: 'low' },
          { name: 'Mid', value: 'mid' },
          { name: 'Important', value: 'imp' }
        ))
        .addStringOption(opt => opt.setName('size').setDescription('Review size (default: medium)').addChoices(
          { name: 'Small', value: 'small' },
          { name: 'Medium', value: 'medium' },
          { name: 'Large', value: 'large' }
        ))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('approve')
        .setDescription('Approve a review')
        .addStringOption(opt => opt.setName('id').setDescription('Review ID (e.g. 1 or REV-1)').setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('reject')
        .setDescription('Reject a review with a comment')
        .addStringOption(opt => opt.setName('id').setDescription('Review ID (e.g. 1 or REV-1)').setRequired(true))
        .addStringOption(opt => opt.setName('comment').setDescription('Reason for rejection').setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('fix-done')
        .setDescription('Mark fixes as done, select who should re-review')
        .addStringOption(opt => opt.setName('id').setDescription('Review ID (e.g. 1 or REV-1)').setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('escalate')
        .setDescription('Escalate a review to senior')
        .addStringOption(opt => opt.setName('id').setDescription('Review ID (e.g. 1 or REV-1)').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for escalation').setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('comment')
        .setDescription('Add a comment to a review')
        .addStringOption(opt => opt.setName('id').setDescription('Review ID (e.g. 1 or REV-1)').setRequired(true))
        .addStringOption(opt => opt.setName('text').setDescription('Comment text').setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('Show active reviews')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('details')
        .setDescription('Show review details')
        .addStringOption(opt => opt.setName('id').setDescription('Review ID (e.g. 1 or REV-1)').setRequired(true))
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const data = require('../utils/data').loadData();
    const reviewer = getReviewerByDiscordId(data, interaction.user.id);

    if (!reviewer && subcommand !== 'status') {
      return interaction.reply({
        content: 'Please link your Discord account first using `/link`.',
        ephemeral: true
      });
    }

    switch (subcommand) {
      case 'create': {
        const branch = interaction.options.getString('branch');
        const type = interaction.options.getString('type');
        const priority = interaction.options.getString('priority');
        const sizeOpt = interaction.options.getString('size') || 'auto';
        const merger = reviewer.name;

        try {
          const review = createReview(branch, merger, type, priority, []);
          if (sizeOpt !== 'auto') review.size = sizeOpt;
          const embed = createReviewEmbed(review, true);
          const mentions = review.reviewers.map(rv => getReviewerMention(rv.name)).filter(m => m.startsWith('<@'));
          const mentionText = mentions.length > 0 ? `\n${mentions.join(' ')} — please review!` : '';
          return interaction.reply({ content: `Review created: **${review.id}**${mentionText}`, embeds: [embed] });
        } catch (err) {
          return interaction.reply({ embeds: [createErrorEmbed(err.message)], ephemeral: true });
        }
      }

      case 'create-commit': {
        const branch = interaction.options.getString('branch');
        const commitsRaw = interaction.options.getString('commits');
        const type = interaction.options.getString('type');
        const priority = interaction.options.getString('priority');
        const merger = reviewer.name;

        const commits = commitsRaw.split(',').map(c => c.trim()).filter(Boolean).slice(0, 3);
        if (commits.length === 0) {
          return interaction.reply({ embeds: [createErrorEmbed('At least 1 commit hash required')], ephemeral: true });
        }

        try {
          const review = createReview(branch, merger, type, priority, commits);
          const embed = createReviewEmbed(review, true);
          const mentions = review.reviewers.map(rv => getReviewerMention(rv.name)).filter(m => m.startsWith('<@'));
          const mentionText = mentions.length > 0 ? `\n${mentions.join(' ')} — please review!` : '';
          return interaction.reply({ content: `Commit review created: **${review.id}**${mentionText}`, embeds: [embed] });
        } catch (err) {
          return interaction.reply({ embeds: [createErrorEmbed(err.message)], ephemeral: true });
        }
      }

      case 'create-manual': {
        if (reviewer.role !== 'admin') {
          return interaction.reply({ content: 'Only admins can create manual reviews.', ephemeral: true });
        }

        const branch = interaction.options.getString('branch');
        const type = interaction.options.getString('type');
        const priority = interaction.options.getString('priority');
        const sizeOpt = interaction.options.getString('size') || 'medium';

        const reviewableReviewers = data.reviewers.filter(r => r.role === 'reviewer' || r.role === 'senior');
        const options = reviewableReviewers.slice(0, 25).map(r => ({
          label: r.name,
          description: `${r.speciality} (load: ${r.load}, wk: ${r.weeklyCount || 0})`,
          value: r.name
        }));

        const select = new StringSelectMenuBuilder()
          .setCustomId(`manual-review_${branch}_${type}_${priority}_${sizeOpt}`)
          .setPlaceholder('Select reviewers (up to 25)')
          .setMinValues(1)
          .setMaxValues(25)
          .addOptions(options);

        const row = new ActionRowBuilder().addComponents(select);

        return interaction.reply({
          content: `Creating manual review for **${branch}** (${sizeOpt}). Select reviewers:`,
          components: [row],
          ephemeral: true
        });
      }

      case 'approve': {
        const id = interaction.options.getString('id');

        try {
          const review = approveReview(id, reviewer.name);
          const embed = createReviewEmbed(review);
          const buttons = createActionButtons(review, reviewer.name);

          const mergerMention = getReviewerMention(review.merger);
          let notifyText = '';
          if (review.status === 'approved') {
            notifyText = `${mergerMention} — your review **${review.branch}** has been fully approved! ✅`;
          } else {
            notifyText = `${mergerMention} — ${reviewer.name} approved your review **${review.branch}** (${review.approvalCount}/${review.reviewers.length})`;
          }

          return interaction.reply({ content: notifyText, embeds: [embed], components: buttons });
        } catch (err) {
          return interaction.reply({ embeds: [createErrorEmbed(err.message)], ephemeral: true });
        }
      }

      case 'reject': {
        const id = interaction.options.getString('id');
        const comment = interaction.options.getString('comment');

        try {
          const review = disapproveReview(id, reviewer.name, comment);
          const embed = createReviewEmbed(review);

          const mergerMention = getReviewerMention(review.merger);
          const notifyText = `${mergerMention} — ${reviewer.name} rejected your review **${review.branch}**:\n> ${comment}`;

          return interaction.reply({ content: notifyText, embeds: [embed] });
        } catch (err) {
          return interaction.reply({ embeds: [createErrorEmbed(err.message)], ephemeral: true });
        }
      }

      case 'fix-done': {
        const id = interaction.options.getString('id');

        try {
          const reviewBefore = getReviewById(id);
          if (!reviewBefore) {
            return interaction.reply({ embeds: [createErrorEmbed('Review not found')], ephemeral: true });
          }
          if (reviewBefore.status !== 'fix_needed') {
            return interaction.reply({ embeds: [createErrorEmbed('Review is not in fix_needed state')], ephemeral: true });
          }

          const disapprovedReviewers = reviewBefore.reviewers.filter(rv => rv.status === 'disapproved');
          const review = markFixDone(id);

          if (disapprovedReviewers.length === 0) {
            const embed = createReviewEmbed(review);
            return interaction.reply({ content: `Fixes marked as done for **${review.id}**`, embeds: [embed] });
          }

          const options = disapprovedReviewers.map(rv => ({
            label: rv.name,
            description: rv.comment ? `Comment: ${rv.comment.slice(0, 50)}` : 'Rejected this review',
            value: rv.name
          }));

          const select = new StringSelectMenuBuilder()
            .setCustomId(`fixdone-notify_${review.id}`)
            .setPlaceholder('Select reviewer to notify')
            .addOptions(options);

          const row = new ActionRowBuilder().addComponents(select);
          const embed = createReviewEmbed(review);

          return interaction.reply({ content: `Fixes marked as done for **${review.id}**. Who should re-review?`, embeds: [embed], components: [row] });
        } catch (err) {
          return interaction.reply({ embeds: [createErrorEmbed(err.message)], ephemeral: true });
        }
      }

      case 'escalate': {
        const id = interaction.options.getString('id');
        const reason = interaction.options.getString('reason');

        try {
          const review = escalateReview(id, reviewer.name, reason, reviewer.role);
          const embed = createReviewEmbed(review);
          return interaction.reply({ embeds: [embed] });
        } catch (err) {
          return interaction.reply({ embeds: [createErrorEmbed(err.message)], ephemeral: true });
        }
      }

      case 'comment': {
        const id = interaction.options.getString('id');
        const text = interaction.options.getString('text');

        try {
          const review = addComment(id, reviewer.name, text);
          const embed = createReviewEmbed(review);
          return interaction.reply({ embeds: [embed] });
        } catch (err) {
          return interaction.reply({ embeds: [createErrorEmbed(err.message)], ephemeral: true });
        }
      }

      case 'status': {
        const reviews = getActiveReviews();
        const embed = createActiveReviewsEmbed(reviews);
        return interaction.reply({ embeds: [embed] });
      }

      case 'details': {
        const id = interaction.options.getString('id');
        const review = getReviewById(id);

        if (!review) {
          return interaction.reply({ embeds: [createErrorEmbed('Review not found')], ephemeral: true });
        }

        const embed = createReviewEmbed(review);
        const buttons = reviewer ? createActionButtons(review, reviewer.name) : [];
        return interaction.reply({ embeds: [embed], components: buttons });
      }
    }
  }
};

function createActionButtons(review, reviewerName) {
  const myReviewer = review.reviewers.find(r => r.name.toLowerCase() === reviewerName.toLowerCase());

  if (!myReviewer || myReviewer.status !== 'pending') return [];
  if (review.status !== 'in_review' && review.status !== 'fix_made') return [];

  const approveButton = new ButtonBuilder()
    .setCustomId(`approve_${review.id}`)
    .setLabel('Approve')
    .setStyle(ButtonStyle.Success);

  const rejectButton = new ButtonBuilder()
    .setCustomId(`reject_${review.id}`)
    .setLabel('Reject')
    .setStyle(ButtonStyle.Danger);

  const row = new ActionRowBuilder().addComponents(approveButton, rejectButton);
  return [row];
}
