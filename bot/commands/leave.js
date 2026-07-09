const { SlashCommandBuilder } = require('discord.js');
const { loadData, saveData, getReviewerByName } = require('../utils/data');
const { selectReviewers } = require('../utils/reviews');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Remove yourself from the reviewer list'),

  async execute(interaction) {
    const discordId = interaction.user.id;
    const data = loadData();

    const reviewer = data.reviewers.find(r => r.discordId === discordId);
    if (!reviewer) {
      return interaction.reply({ content: 'Your Discord account is not linked to any reviewer. Nothing to do.', ephemeral: true });
    }

    const name = reviewer.name;
    reviewer.discordId = '';

    // Reassign active reviews to other reviewers
    let reassignedCount = 0;
    for (const review of data.reviews) {
      if (review.status !== 'in_review' && review.status !== 'fix_made') continue;

      const reviewerEntry = review.reviewers.find(r => r.name === name && r.status === 'pending');
      if (!reviewerEntry) continue;

      // Find replacement
      const assignedNames = review.reviewers.map(r => r.name);
      const replacements = selectReviewers(data, review.reviewType, 1, review.merger);
      const availableReplacements = replacements.filter(r => !assignedNames.includes(r.name));

      if (availableReplacements.length > 0) {
        const replacement = availableReplacements[0];
        review.reviewers = review.reviewers.filter(r => r.name !== name);
        review.reviewers.push({ name: replacement.name, status: 'pending', notified: false });
        const replacementReviewer = getReviewerByName(data, replacement.name);
        if (replacementReviewer) {
          replacementReviewer.load = Math.min(replacementReviewer.load + 1, data.settings.maxLoad || 3);
        }
        reassignedCount++;
      } else {
        review.reviewers = review.reviewers.filter(r => r.name !== name);
      }
    }

    reviewer.load = 0;
    const msg = reassignedCount > 0
      ? `User ${name} left, ${reassignedCount} review(s) reassigned`
      : `User ${name} left (Discord unlinked)`;
    saveData(data, msg);

    return interaction.reply({ content: `You have been unlinked from reviewer **${name}**. ${reassignedCount > 0 ? `${reassignedCount} review(s) were reassigned.` : ''} You can re-link later with \`/link\`.`, ephemeral: true });
  }
};
