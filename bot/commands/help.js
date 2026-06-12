const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { loadData, getReviewerByDiscordId } = require('../utils/data');
const fs = require('fs');
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show available commands'),

  async execute(interaction) {
    const data = loadData();
    const user = getReviewerByDiscordId(data, interaction.user.id);
    
    // Load all command files
    const commandsDir = path.join(__dirname);
    const commandFiles = fs.readdirSync(commandsDir).filter(f => f.endsWith('.js') && f !== 'help.js');
    
    const userCommands = [];
    const adminCommands = [];
    
    for (const file of commandFiles) {
      const command = require(path.join(commandsDir, file));
      const cmdData = command.data;
      
      if (!cmdData || !cmdData.name) continue;
      
      const cmdName = cmdData.name;
      const cmdDesc = cmdData.description;
      
      // Check if it's an admin command
      if (cmdName === 'admin') {
        // Parse admin subcommands
        if (cmdData.options && cmdData.options.length > 0) {
          for (const opt of cmdData.options) {
            if (opt.type === 1) { // SUBCOMMAND
              const subName = opt.name;
              const subDesc = opt.description;
              const options = opt.options || [];
              const optStr = options.map(o => `\`${o.name}\``).join(', ');
              adminCommands.push({
                name: `/admin ${subName}`,
                desc: subDesc,
                options: optStr
              });
            }
          }
        }
      } else if (cmdName === 'review') {
        // Parse review subcommands
        if (cmdData.options && cmdData.options.length > 0) {
          for (const opt of cmdData.options) {
            if (opt.type === 1) { // SUBCOMMAND
              const subName = opt.name;
              const subDesc = opt.description;
              const options = opt.options || [];
              const optStr = options.map(o => `\`${o.name}\``).join(', ');
              userCommands.push({
                name: `/review ${subName}`,
                desc: subDesc,
                options: optStr
              });
            }
          }
        }
      } else {
        // Regular command
        const options = cmdData.options || [];
        const optStr = options.map(o => `\`${o.name}\``).join(', ');
        userCommands.push({
          name: `/${cmdName}`,
          desc: cmdDesc,
          options: optStr
        });
      }
    }
    
    // Build embed
    const embed = new EmbedBuilder()
      .setColor(0x0099FF)
      .setTitle('📖 Available Commands')
      .setDescription('Here are the commands you can use:')
      .setTimestamp();
    
    // Add user commands
    if (userCommands.length > 0) {
      const userCmdText = userCommands.map(cmd => {
        let text = `**${cmd.name}** — ${cmd.desc}`;
        if (cmd.options) text += `\n  Options: ${cmd.options}`;
        return text;
      }).join('\n\n');
      
      embed.addFields({ name: '👤 User Commands', value: userCmdText, inline: false });
    }
    
    // Add admin commands if user is admin
    if (user && user.role === 'admin' && adminCommands.length > 0) {
      const adminCmdText = adminCommands.map(cmd => {
        let text = `**${cmd.name}** — ${cmd.desc}`;
        if (cmd.options) text += `\n  Options: ${cmd.options}`;
        return text;
      }).join('\n\n');
      
      embed.addFields({ name: '👑 Admin Commands', value: adminCmdText, inline: false });
    }
    
    embed.setFooter({ text: 'Use /command followed by options to execute' });
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
