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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('review')
    .setDescription('Review management commands')
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('Create a new review (auto-assign reviewers)')
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
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('create-commit')
        .setDescription('Create a review for a commit (auto-assign reviewers)')
        .addStringOption(opt => opt.setName('commit').setDescription('Commit hash or message').setRequired(true))
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
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('unassign')
        .setDescription('Unassign yourself from a review (notifies admin)')
        .addStringOption(opt => opt.setName('id').setDescription('Review ID (e.g. 1 or REV-1)').setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('senior-approve')
        .setDescription('Force-approve a review (senior only — bypasses approval count)')
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
        const merger = reviewer.name;

        try {
          const review = createReview(branch, merger, type, priority);
          const embed = createReviewEmbed(review, true);
          const mentions = review.reviewers.map(rv => getReviewerMention(rv.name)).filter(m => m.startsWith('<@'));
          const mentionText = mentions.length > 0 ? `\n${mentions.join(' ')} — please review!` : '';
          return interaction.reply({ content: `Review created: **${review.id}**${mentionText}`, embeds: [embed] });
        } catch (err) {
          return interaction.reply({ embeds: [createErrorEmbed(err.message)], ephemeral: true });
        }
      }

      case 'create-commit': {
        const commit = interaction.options.getString('commit');
        const branch = interaction.options.getString('branch');
        const type = interaction.options.getString('type');
        const priority = interaction.options.getString('priority');
        const merger = reviewer.name;

        try {
          const review = createReview(branch, merger, type, priority, commit);
          const embed = createReviewEmbed(review, true);
          const mentions = review.reviewers.map(rv => getReviewerMention(rv.name)).filter(m => m.startsWith('<@'));
          const mentionText = mentions.length > 0 ? `\n${mentions.join(' ')} — please review!` : '';
          return interaction.reply({ content: `Review created: **${review.id}**${mentionText}`, embeds: [embed] });
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

        const reviewableReviewers = data.reviewers.filter(r => r.role === 'reviewer' || r.role === 'senior');
        const options = reviewableReviewers.slice(0, 25).map(r => ({
          label: r.name,
          description: `${r.speciality} (load: ${r.load})`,
          value: r.name
        }));

        const select = new StringSelectMenuBuilder()
          .setCustomId(`manual-review_${branch}_${type}_${priority}`)
          .setPlaceholder('Select reviewers (up to 25)')
          .setMinValues(1)
          .setMaxValues(25)
          .addOptions(options);

        const row = new ActionRowBuilder().addComponents(select);

        return interaction.reply({
          content: `Creating manual review for **${branch}**. Select reviewers:`,
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

      case 'unassign': {
        const id = interaction.options.getString('id');
        const review = getReviewById(id);

        if (!review) {
          return interaction.reply({ embeds: [createErrorEmbed('Review not found')], ephemeral: true });
        }

        if (review.status === 'deleted') {
          return interaction.reply({ embeds: [createErrorEmbed('Cannot unassign from a deleted review')], ephemeral: true });
        }

        const myReviewer = review.reviewers.find(r => r.name.toLowerCase() === reviewer.name.toLowerCase());

        if (!myReviewer) {
          return interaction.reply({ embeds: [createErrorEmbed('You are not assigned to this review')], ephemeral: true });
        }

        if (myReviewer.status !== 'pending') {
          return interaction.reply({ embeds: [createErrorEmbed('You have already responded to this review')], ephemeral: true });
        }

        // Decrement load
        if (reviewer.load > 0) {
          reviewer.load--;
        }

        // Remove reviewer from review
        review.reviewers = review.reviewers.filter(r => r.name.toLowerCase() !== reviewer.name.toLowerCase());
        review.updatedAt = new Date().toISOString();

        const { saveData } = require('../utils/data');
        saveData(data, `${reviewer.name} unassigned from review ${review.id}`);

        // Notify admins
        const admins = data.reviewers.filter(r => r.role === 'admin' && r.discordId);
        const adminMentions = admins.map(a => `<@${a.discordId}>`).join(' ');

        return interaction.reply({
          content: `${adminMentions}\n⚠️ **${reviewer.name}** has unassigned themselves from review **${review.id}** (${review.branch}).`,
          embeds: [createErrorEmbed(`You have been unassigned from review **${review.id}**. An admin has been notified.`)]
        });
      }

      case 'senior-approve': {
        if (reviewer.role !== 'senior') {
          return interaction.reply({ content: 'Only seniors can use this command.', ephemeral: true });
        }

        const id = interaction.options.getString('id');
        const review = getReviewById(id);

        if (!review) {
          return interaction.reply({ embeds: [createErrorEmbed('Review not found')], ephemeral: true });
        }

        if (review.status !== 'in_review' && review.status !== 'fix_made') {
          return interaction.reply({ embeds: [createErrorEmbed('Review is not in a reviewable state')], ephemeral: true });
        }

        const { saveData } = require('../utils/data');
        let approvedCount = 0;
        for (const rv of review.reviewers) {
          if (rv.status === 'pending') {
            rv.status = 'approved';
            rv.respondedAt = new Date().toISOString();
            // Decrement load for the reviewer being approved
            const rev = data.reviewers.find(r => r.name.toLowerCase() === rv.name.toLowerCase());
            if (rev && rev.load > 0) rev.load--;
            approvedCount++;
          }
        }

        review.approvalCount = review.reviewers.length;
        review.status = 'approved';
        review.updatedAt = new Date().toISOString();
        saveData(data, `Review ${review.id} senior-approved by ${reviewer.name}`);

        const embed = require('../utils/embeds').createReviewEmbed(review);
        return interaction.reply({
          content: `✅ Senior approved **${review.id}** (${review.branch}). All pending responses marked as approved.`,
          embeds: [embed]
        });
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
