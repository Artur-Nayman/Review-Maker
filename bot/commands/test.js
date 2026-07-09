const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { loadData } = require('../utils/data');
const http = require('http');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('test')
    .setDescription('Show bot, DB, and API status'),

  async execute(interaction) {
    const data = loadData();

    const activeReviews = data.reviews.filter(r => r.status !== 'approved' && r.status !== 'rejected' && r.status !== 'deleted');
    const reviewerCount = data.reviewers.length;
    const linkedCount = data.reviewers.filter(r => r.discordId).length;

    let apiStatus = '❌ Unreachable';
    let apiLatency = 'N/A';
    try {
      const start = Date.now();
      await new Promise((resolve, reject) => {
        const req = http.get('http://localhost:3000/api/reviews', (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            apiLatency = `${Date.now() - start}ms`;
            apiStatus = res.statusCode === 200 ? '✅ OK' : `⚠️ ${res.statusCode}`;
            resolve();
          });
        });
        req.on('error', reject);
        req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
      });
    } catch (e) {
      apiStatus = `❌ ${e.message}`;
    }

    const embed = new EmbedBuilder()
      .setTitle('System Status')
      .setColor(0x3B82F6)
      .addFields(
        { name: '🤖 Bot', value: [
          `Tag: ${interaction.client.user.tag}`,
          `Latency: ${interaction.client.ws.ping}ms`,
          `Guilds: ${interaction.client.guilds.cache.size}`,
        ].join('\n'), inline: false },
        { name: '💾 Database', value: [
          `Reviews: ${data.reviews.length} (${activeReviews.length} active)`,
          `Reviewers: ${reviewerCount} (${linkedCount} linked)`,
          `Next ID: REV-${data.settings.nextReviewNumber || '?'}`,
        ].join('\n'), inline: false },
        { name: '🌐 API Server', value: [
          `Status: ${apiStatus}`,
          `Latency: ${apiLatency}`,
          `URL: http://localhost:3000`,
        ].join('\n'), inline: false },
      )
      .setFooter({ text: `Review Maker v${require('../../package.json').version || '?'}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: false });
  }
};
