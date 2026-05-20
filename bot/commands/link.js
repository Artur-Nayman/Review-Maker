const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { loadData, saveData, getReviewerByDiscordId } = require('../utils/data');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your Discord account to a reviewer account'),

  async execute(interaction) {
    const data = loadData();
    const existing = getReviewerByDiscordId(data, interaction.user.id);

    if (existing) {
      return interaction.reply({
        content: `Your Discord account is already linked to **${existing.name}** (${existing.role}).`,
        ephemeral: true
      });
    }

    const available = data.reviewers.filter(r => !r.discordId);

    if (available.length === 0) {
      return interaction.reply({
        content: 'All reviewer accounts are already linked to Discord users.',
        ephemeral: true
      });
    }

    const options = available.slice(0, 25).map(r => ({
      label: r.name,
      description: `${r.role} - ${r.speciality}`,
      value: r.name
    }));

    const select = new StringSelectMenuBuilder()
      .setCustomId('link-select')
      .setPlaceholder('Select your reviewer account')
      .addOptions(options);

    const row = new ActionRowBuilder().addComponents(select);

    await interaction.reply({
      content: 'Select your reviewer account:',
      components: [row],
      ephemeral: true
    });
  }
};
