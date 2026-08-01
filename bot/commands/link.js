const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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

    const available = data.reviewers.filter(r => !r.discordId && !r.disabled);
    const components = [];

    if (available.length > 0) {
      const options = available.slice(0, 25).map(r => ({
        label: r.name,
        description: `${r.role} - ${r.speciality}`,
        value: r.name
      }));

      const select = new StringSelectMenuBuilder()
        .setCustomId('link-select')
        .setPlaceholder('Select your reviewer account')
        .addOptions(options);

      components.push(new ActionRowBuilder().addComponents(select));
    }

    const registerBtn = new ButtonBuilder()
      .setCustomId('link-register')
      .setLabel('Register as new reviewer')
      .setStyle(ButtonStyle.Primary);

    components.push(new ActionRowBuilder().addComponents(registerBtn));

    await interaction.reply({
      content: available.length > 0
        ? 'Select your reviewer account, or register as a new one:'
        : 'No unlinked accounts found. Register as a new reviewer:',
      components,
      ephemeral: true
    });
  }
};
