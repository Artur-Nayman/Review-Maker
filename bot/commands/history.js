const { SlashCommandBuilder } = require('discord.js');
const { getAuditLog } = require('../../server/db');
const { createAuditLogEmbed, createHistoryEmbed } = require('../utils/embeds');
const { getReviewHistory } = require('../utils/reviews');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('Show history and audit log')
    .addSubcommand(subcommand =>
      subcommand
        .setName('all')
        .setDescription('Show recent audit log activity')
        .addIntegerOption(opt =>
          opt.setName('limit')
            .setDescription('Number of entries (default 20)')
            .setMinValue(1)
            .setMaxValue(50)
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('reviews')
        .setDescription('Show completed reviews from last 30 days')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'all') {
      const limit = interaction.options.getInteger('limit') || 20;
      const entries = getAuditLog(limit);
      const embed = createAuditLogEmbed(entries);
      return interaction.reply({ embeds: [embed] });
    }

    if (subcommand === 'reviews') {
      const reviews = getReviewHistory();
      const embed = createHistoryEmbed(reviews);
      return interaction.reply({ embeds: [embed] });
    }
  }
};
