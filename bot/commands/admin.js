const { SlashCommandBuilder } = require('discord.js');
const bcrypt = require('bcryptjs');
const { loadData, saveData, getReviewerByName, getReviewerByDiscordId, generatePassword, getReviewerCapacity } = require('../utils/data');
const { createPasswordsEmbed, createSuccessEmbed, createErrorEmbed, createReviewersEmbed, createWorkloadEmbed, createDashboardEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Admin commands (admin only)')
    .addSubcommand(subcommand =>
      subcommand
        .setName('passwords')
        .setDescription('View all user passwords')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('reset-password')
        .setDescription('Reset a user password')
        .addStringOption(opt => opt.setName('user').setDescription('User name').setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set-password')
        .setDescription('Set a user password')
        .addStringOption(opt => opt.setName('user').setDescription('User name').setRequired(true))
        .addStringOption(opt => opt.setName('password').setDescription('New password').setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('add-user')
        .setDescription('Add a new user')
        .addStringOption(opt => opt.setName('name').setDescription('User name').setRequired(true))
        .addStringOption(opt => opt.setName('speciality').setDescription('Speciality').addChoices(
          { name: 'Fullstack', value: 'Fullstack' },
          { name: 'Frontend', value: 'Frontend' },
          { name: 'Backend', value: 'Backend' }
        ))
        .addStringOption(opt => opt.setName('role').setDescription('Role').addChoices(
          { name: 'Reviewer', value: 'reviewer' },
          { name: 'Senior', value: 'senior' },
          { name: 'Scrum Master', value: 'scrum_master' },
          { name: 'Manager', value: 'manager' }
        ))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove-user')
        .setDescription('Remove a user')
        .addStringOption(opt => opt.setName('user').setDescription('User name').setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set-role')
        .setDescription('Change a user role')
        .addStringOption(opt => opt.setName('user').setDescription('User name').setRequired(true))
        .addStringOption(opt => opt.setName('role').setDescription('New role').setRequired(true).addChoices(
          { name: 'Reviewer', value: 'reviewer' },
          { name: 'Senior', value: 'senior' },
          { name: 'Scrum Master', value: 'scrum_master' },
          { name: 'Manager', value: 'manager' },
          { name: 'Admin', value: 'admin' }
        ))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('reviewers')
        .setDescription('Show all reviewers and their loads')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('workload')
        .setDescription('Show detailed reviewer workload table')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('dashboard')
        .setDescription('Show review dashboard summary')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set-load')
        .setDescription('Set a reviewer load manually')
        .addStringOption(opt => opt.setName('user').setDescription('User name').setRequired(true))
        .addIntegerOption(opt => opt.setName('load').setDescription('New load value').setRequired(true).setMinValue(0).setMaxValue(999))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set-weekly')
        .setDescription('Set weekly review cap for a reviewer')
        .addStringOption(opt => opt.setName('user').setDescription('User name').setRequired(true))
        .addIntegerOption(opt => opt.setName('cap').setDescription('New weekly cap').setRequired(true).setMinValue(1).setMaxValue(20))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('settings')
        .setDescription('View or edit settings')
        .addStringOption(opt => opt.setName('key').setDescription('Setting key (optional — omit to view all)'))
        .addStringOption(opt => opt.setName('value').setDescription('New value (omit to view current)'))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('unlink')
        .setDescription('Remove a user Discord link so they can re-link')
        .addStringOption(opt => opt.setName('user').setDescription('User name').setRequired(true))
    ),

  async execute(interaction) {
    const data = loadData();
    const user = getReviewerByDiscordId(data, interaction.user.id);

    if (!user || user.role !== 'admin') {
      return interaction.reply({
        content: 'This command is only available to admins.',
        ephemeral: true
      });
    }

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'passwords': {
        const passwords = data.reviewers.map(r => ({
          name: r.name,
          role: r.role,
          plainPassword: r.plainPassword || 'Not set'
        }));
        const embed = createPasswordsEmbed(passwords);
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      case 'reset-password': {
        const name = interaction.options.getString('user');
        const reviewer = getReviewerByName(data, name);

        if (!reviewer) {
          return interaction.reply({ embeds: [createErrorEmbed('User not found')], ephemeral: true });
        }

        const newPassword = generatePassword();
        reviewer.password = await bcrypt.hash(newPassword, 10);
        reviewer.plainPassword = newPassword;
        saveData(data, "Bot admin action");

        return interaction.reply({
          embeds: [createSuccessEmbed(`New password for **${name}**: \`${newPassword}\``)],
          ephemeral: true
        });
      }

      case 'set-password': {
        const name = interaction.options.getString('user');
        const password = interaction.options.getString('password');
        const reviewer = getReviewerByName(data, name);

        if (!reviewer) {
          return interaction.reply({ embeds: [createErrorEmbed('User not found')], ephemeral: true });
        }

        if (password.length < 4) {
          return interaction.reply({ embeds: [createErrorEmbed('Password must be at least 4 characters')], ephemeral: true });
        }

        reviewer.password = await bcrypt.hash(password, 10);
        reviewer.plainPassword = password;
        saveData(data, "Bot admin action");

        return interaction.reply({
          embeds: [createSuccessEmbed(`Password set for **${name}**: \`${password}\``)],
          ephemeral: true
        });
      }

      case 'add-user': {
        const name = interaction.options.getString('name');
        const speciality = interaction.options.getString('speciality') || 'Fullstack';
        const role = interaction.options.getString('role') || 'reviewer';

        if (getReviewerByName(data, name)) {
          return interaction.reply({ embeds: [createErrorEmbed('User already exists')], ephemeral: true });
        }

        const isNonReview = role === 'admin' || role === 'manager' || role === 'scrum_master';
        const finalSpeciality = isNonReview ? 'None' : speciality;
        const generatedPassword = generatePassword();

        data.reviewers.push({
          name,
          load: 0,
          weeklyCount: 0,
          weeklyResetAt: new Date().toISOString(),
          currentLargeReview: false,
          maxActiveReviews: data.settings.maxWeeklyReviews || 5,
          maxLargeSimultaneous: data.settings.maxLargeSimultaneous || 1,
          speciality: finalSpeciality,
          role,
          email: '',
          password: await bcrypt.hash(generatedPassword, 10),
          plainPassword: generatedPassword,
          discordId: ''
        });

        saveData(data, "Bot admin action");

        return interaction.reply({
          embeds: [createSuccessEmbed(`User **${name}** added with password: \`${generatedPassword}\``)],
          ephemeral: true
        });
      }

      case 'remove-user': {
        const name = interaction.options.getString('user');
        const idx = data.reviewers.findIndex(r => r.name.toLowerCase() === name.toLowerCase());

        if (idx === -1) {
          return interaction.reply({ embeds: [createErrorEmbed('User not found')], ephemeral: true });
        }

        if (data.reviewers[idx].role === 'admin') {
          return interaction.reply({ embeds: [createErrorEmbed('Cannot delete admin')], ephemeral: true });
        }

        data.reviewers.splice(idx, 1);
        saveData(data, "Bot admin action");

        return interaction.reply({
          embeds: [createSuccessEmbed(`User **${name}** removed`)]
        });
      }

      case 'set-role': {
        const name = interaction.options.getString('user');
        const role = interaction.options.getString('role');
        const reviewer = getReviewerByName(data, name);

        if (!reviewer) {
          return interaction.reply({ embeds: [createErrorEmbed('User not found')], ephemeral: true });
        }

        if (role === 'senior') {
          const currentSenior = data.reviewers.find(r => r.role === 'senior');
          if (currentSenior && currentSenior.name !== reviewer.name) {
            currentSenior.role = 'reviewer';
          }
        }

        const isNonReview = role === 'admin' || role === 'manager' || role === 'scrum_master';
        if (isNonReview) {
          reviewer.speciality = 'None';
        }

        reviewer.role = role;
        saveData(data, "Bot admin action");

        return interaction.reply({
          embeds: [createSuccessEmbed(`Role for **${name}** changed to **${role}**`)]
        });
      }

      case 'reviewers': {
        const settings = data.settings;
        const embed = createReviewersEmbed(data.reviewers, settings);
        return interaction.reply({ embeds: [embed] });
      }

      case 'workload': {
        const embed = createWorkloadEmbed(data.reviewers, data.settings);
        return interaction.reply({ embeds: [embed] });
      }

      case 'dashboard': {
        const embed = createDashboardEmbed(data);
        return interaction.reply({ embeds: [embed] });
      }

      case 'set-load': {
        const name = interaction.options.getString('user');
        const load = interaction.options.getInteger('load');
        const reviewer = getReviewerByName(data, name);

        if (!reviewer) {
          return interaction.reply({ embeds: [createErrorEmbed('User not found')], ephemeral: true });
        }

        reviewer.load = load;
        saveData(data, "Bot admin action");

        return interaction.reply({
          embeds: [createSuccessEmbed(`Load for **${name}** set to **${load}**`)]
        });
      }

      case 'set-weekly': {
        const name = interaction.options.getString('user');
        const cap = interaction.options.getInteger('cap');
        const reviewer = getReviewerByName(data, name);

        if (!reviewer) {
          return interaction.reply({ embeds: [createErrorEmbed('User not found')], ephemeral: true });
        }

        reviewer.maxActiveReviews = cap;
        saveData(data, "Bot admin action");

        return interaction.reply({
          embeds: [createSuccessEmbed(`Weekly review cap for **${name}** set to **${cap}**`)]
        });
      }

      case 'settings': {
        const key = interaction.options.getString('key');
        const value = interaction.options.getString('value');

        if (key && value) {
          const numValue = parseInt(value);
          if (!isNaN(numValue)) {
            data.settings[key] = numValue;
          } else if (value === 'true') {
            data.settings[key] = true;
          } else if (value === 'false') {
            data.settings[key] = false;
          } else {
            data.settings[key] = value;
          }
          saveData(data, "Bot admin action");
          return interaction.reply({
            embeds: [createSuccessEmbed(`Setting **${key}** changed to \`${data.settings[key]}\``)]
          });
        }

        let desc = '```\n';
        for (const [k, v] of Object.entries(data.settings)) {
          if (k === 'adminPassword') continue;
          desc += `${k.padEnd(30)} ${v}\n`;
        }
        desc += '```\nUse `/admin settings key:value` to change.';
        return interaction.reply({ content: desc, ephemeral: true });
      }

      case 'unlink': {
        const name = interaction.options.getString('user');
        const reviewer = getReviewerByName(data, name);

        if (!reviewer) {
          return interaction.reply({ embeds: [createErrorEmbed('User not found')], ephemeral: true });
        }

        if (!reviewer.discordId) {
          return interaction.reply({ embeds: [createErrorEmbed(`${name} is not linked to any Discord account`)], ephemeral: true });
        }

        reviewer.discordId = '';
        saveData(data, `Discord link removed for ${name}`);

        return interaction.reply({
          embeds: [createSuccessEmbed(`Discord link removed for **${name}**. They need to use \`/link\` again.`)]
        });
      }
    }
  }
};
