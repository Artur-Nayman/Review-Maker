const { SlashCommandBuilder } = require('discord.js');
const { getReviewerByDiscordId, loadData } = require('../utils/data');
const { flagNeedAttention } = require('../utils/reviews');
const { createReviewEmbed, createErrorEmbed, createSuccessEmbed, getReviewerMention } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('needattention')
    .setDescription('Flag an approved review that needs rebase/attention after upstream changes')
    .addStringOption(opt =>
      opt.setName('id').setDescription('Review ID (e.g. REV-42)').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('comment').setDescription('Reason this review needs attention').setRequired(true)
    ),

  async execute(interaction) {
    const data = loadData();
    const reviewer = getReviewerByDiscordId(data, interaction.user.id);

    if (!reviewer) {
      return interaction.reply({
        content: 'Please link your Discord account first using `/link`.',
        ephemeral: true
      });
    }

    const id = interaction.options.getString('id');
    const comment = interaction.options.getString('comment');

    try {
      const review = flagNeedAttention(id, comment, reviewer.name);
      const embed = createReviewEmbed(review);

      const mergerMention = getReviewerMention(review.merger);
      const notifyText = `${mergerMention} — **${review.branch}** flagged for attention by ${reviewer.name}:\n> ${comment}`;

      await interaction.reply({ content: notifyText, embeds: [embed] });
    } catch (err) {
      await interaction.reply({ embeds: [createErrorEmbed(err.message)], ephemeral: true });
    }
  }
};
