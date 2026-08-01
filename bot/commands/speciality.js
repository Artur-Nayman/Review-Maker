const { SlashCommandBuilder } = require('discord.js');
const { loadData, saveData, getReviewerByDiscordId } = require('../utils/data');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('speciality')
    .setDescription('Change your review speciality')
    .addStringOption(opt => opt.setName('speciality').setDescription('Your speciality').setRequired(true).addChoices(
      { name: 'Fullstack', value: 'Fullstack' },
      { name: 'Frontend', value: 'Frontend' },
      { name: 'Backend', value: 'Backend' },
      { name: 'None', value: 'None' }
    )),

  async execute(interaction) {
    const data = loadData();
    const reviewer = getReviewerByDiscordId(data, interaction.user.id);

    if (!reviewer) {
      return interaction.reply({
        content: 'Please link your Discord account first using `/link`.',
        ephemeral: true
      });
    }

    const newSpeciality = interaction.options.getString('speciality');
    const oldSpeciality = reviewer.speciality;
    reviewer.speciality = newSpeciality;
    saveData(data, `${reviewer.name} changed speciality from ${oldSpeciality} to ${newSpeciality}`);

    return interaction.reply({
      embeds: [createSuccessEmbed(`Your speciality has been changed from **${oldSpeciality}** to **${newSpeciality}**`)],
      ephemeral: true
    });
  }
};
