const { SlashCommandBuilder } = require('discord.js');
const { getReviewerByDiscordId, loadData } = require('../utils/data');
const { createReviewEmbed, createReviewersEmbed, createActiveReviewsEmbed, createHistoryEmbed, createErrorEmbed } = require('../utils/embeds');
const { getActiveReviews, getReviewHistory, getReviewById } = require('../utils/reviews');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('my-reviews')
    .setDescription('Show your assigned reviews'),

  async execute(interaction) {
    const data = loadData();
    const reviewer = getReviewerByDiscordId(data, interaction.user.id);

    if (!reviewer) {
      return interaction.reply({
        content: 'Please link your Discord account first using `/link`.',
        ephemeral: true
      });
    }

    const active = getActiveReviews();
    const myReviews = active.filter(r =>
      r.merger.toLowerCase() === reviewer.name.toLowerCase() ||
      r.reviewers.some(rv => rv.name.toLowerCase() === reviewer.name.toLowerCase())
    );

    if (myReviews.length === 0) {
      return interaction.reply({
        content: 'You have no active reviews.',
        ephemeral: true
      });
    }

    let description = '';
    myReviews.forEach(r => {
      const isMerger = r.merger.toLowerCase() === reviewer.name.toLowerCase();
      const myReviewer = r.reviewers.find(rv => rv.name.toLowerCase() === reviewer.name.toLowerCase());
      const role = isMerger ? 'Merger' : `Reviewer (${myReviewer?.status || 'unknown'})`;

      description += `**${r.branch}** - ${r.status}\n`;
      description += `Role: ${role} | Priority: ${r.priority} | Approvals: ${r.approvalCount}/${r.reviewers.length}\n`;
      description += `ID: \`${r.id.slice(0, 8)}...\`\n\n`;
    });

    const { EmbedBuilder } = require('discord.js');
    const embed = new EmbedBuilder()
      .setTitle('My Reviews')
      .setColor(0x3B82F6)
      .setDescription(description);

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
