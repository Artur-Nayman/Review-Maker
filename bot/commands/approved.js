const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { loadData } = require('../utils/data');
const { priorityEmoji } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('approved')
    .setDescription('Show fully approved reviews ready to merge'),

  async execute(interaction) {
    const data = loadData();
    const approved = data.reviews
      .filter(r => r.status === 'approved')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 25);

    const embed = new EmbedBuilder()
      .setTitle('✅ Approved Reviews (Ready to Merge)')
      .setColor(0x10B981)
      .setTimestamp();

    if (approved.length === 0) {
      embed.setDescription('No reviews are fully approved and ready to merge.');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    let description = '';
    for (const r of approved) {
      const titleText = r.mrUrl ? `[${r.branch}](${r.mrUrl})` : r.branch;
      const mrTag = r.mrIid ? `MR !${r.mrIid}` : r.id;
      description += `${priorityEmoji(r.priority)} ${titleText}\n`;
      description += `${mrTag} • Merger: ${r.merger} • ${new Date(r.createdAt).toLocaleDateString()}\n\n`;
    }
    embed.setDescription(description);
    return interaction.reply({ embeds: [embed] });
  }
};
