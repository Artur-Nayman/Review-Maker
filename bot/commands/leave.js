const { SlashCommandBuilder } = require('discord.js');
const { loadData, saveData, getReviewerByName } = require('../utils/data');

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

    if (reviewer.role === 'admin') {
      return interaction.reply({ content: 'Admins cannot leave. Ask another admin to reassign.', ephemeral: true });
    }

    const name = reviewer.name;
    reviewer.discordId = '';

    // If they have active reviews, decrement their load
    for (const review of data.reviews) {
      if (review.status === 'in_review' || review.status === 'fix_made') {
        const rv = review.reviewers.find(r => r.name === name && r.status === 'pending');
        if (rv) {
          reviewer.load = Math.max(0, reviewer.load - 1);
        }
      }
    }

    saveData(data, `User ${name} left (Discord unlinked)`);

    return interaction.reply({ content: `You have been unlinked from reviewer **${name}**. You can re-link later with \`/link\`.`, ephemeral: true });
  }
};
