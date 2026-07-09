const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

function humanUptime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h % 24 > 0) parts.push(`${h % 24}h`);
  if (m % 60 > 0) parts.push(`${m % 60}m`);
  parts.push(`${s % 60}s`);
  return parts.join(' ');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('health')
    .setDescription('Show bot health status'),

  async execute(interaction) {
    const h = interaction.client.health;

    const statusEmoji = {
      connected: '🟢',
      connecting: '🟡',
      reconnecting: '🟡',
      disconnected: '🔴',
      ok: '🟢',
      error: '🔴',
      unknown: '⚪'
    };

    const discordStatus = `${statusEmoji[h.discord.status] || '⚪'} ${h.discord.status}`;
    const sheetsStatus = `${statusEmoji[h.sheets.status] || '⚪'} ${h.sheets.status}`;
    const dbStatus = `${statusEmoji[h.db.status] || '⚪'} ${h.db.status}`;

    const embed = new EmbedBuilder()
      .setTitle('Bot Health')
      .setColor(h.discord.status === 'connected' ? 0x10B981 : 0xF59E0B)
      .addFields(
        { name: 'Uptime', value: humanUptime(Date.now() - h.startedAt), inline: true },
        { name: 'Discord Ping', value: `${h.discord.ping}ms`, inline: true },
        { name: 'Discord', value: discordStatus, inline: true },
        { name: 'Google API', value: sheetsStatus, inline: true },
        { name: 'Database (SQLite)', value: dbStatus, inline: true },
        { name: 'Last Git Pull', value: h.git.lastPullResult || 'never', inline: false }
      )
      .setFooter({ text: 'Auto-pulls every 5 min · Health checks every 30 min' })
      .setTimestamp();

    if (h.discord.lastDisconnect) {
      embed.addFields({
        name: 'Last Discord Disconnect',
        value: `<t:${Math.floor(h.discord.lastDisconnect / 1000)}:R>`,
        inline: true
      });
    }

    if (h.sheets.lastError) {
      embed.addFields({
        name: 'Sheets Error',
        value: `\`${h.sheets.lastError.slice(0, 200)}\``,
        inline: false
      });
    }

    if (h.db.lastError) {
      embed.addFields({
        name: 'DB Error',
        value: `\`${h.db.lastError.slice(0, 200)}\``,
        inline: false
      });
    }

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
