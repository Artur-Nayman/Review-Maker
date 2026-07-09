const { SlashCommandBuilder } = require('discord.js');
const bcrypt = require('bcryptjs');
const { loadData, saveData, getReviewerByName, getReviewerByDiscordId, generatePassword, getReviewerCapacity, findReviewById } = require('../utils/data');
const { createSuccessEmbed, createErrorEmbed, createReviewersEmbed, createWorkloadEmbed, createDashboardEmbed } = require('../utils/embeds');
const { exec } = require('child_process');
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Admin commands (admin only)')
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
          { name: 'Backend', value: 'Backend' },
          { name: 'None', value: 'None' }
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
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('delete-review')
        .setDescription('Soft-delete a review by ID (admin only)')
        .addStringOption(opt => opt.setName('id').setDescription('Review ID (e.g. REV-42 or just 42)').setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('full-approve')
        .setDescription('Fully approve a review (admin only)')
        .addStringOption(opt => opt.setName('id').setDescription('Review ID (e.g. REV-42 or just 42)').setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('reassign')
        .setDescription('Reassign reviewers to a review (admin only)')
        .addStringOption(opt => opt.setName('id').setDescription('Review ID (e.g. REV-42 or just 42)').setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('restore-review')
        .setDescription('Restore a soft-deleted review (admin only)')
        .addStringOption(opt => opt.setName('id').setDescription('Review ID (e.g. REV-42 or just 42)').setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('reset-review')
        .setDescription('Reset review to pending state (admin only)')
        .addStringOption(opt => opt.setName('id').setDescription('Review ID (e.g. REV-42 or just 42)').setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set-deadline')
        .setDescription('Manually set deadline for a review (admin only)')
        .addStringOption(opt => opt.setName('id').setDescription('Review ID (e.g. REV-42 or just 42)').setRequired(true))
        .addStringOption(opt => opt.setName('deadline').setDescription('Deadline (YYYY-MM-DD or days from now)').setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('broadcast')
        .setDescription('Send a message to all reviewers (admin only)')
        .addStringOption(opt => opt.setName('message').setDescription('Message to broadcast').setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('git-pull')
        .setDescription('Force git pull from dashboard-remote and restart on changes')
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
      case 'reset-password': {
        const name = interaction.options.getString('user');
        const reviewer = getReviewerByName(data, name);

        if (!reviewer) {
          return interaction.reply({ embeds: [createErrorEmbed('User not found')], ephemeral: true });
        }

        const newPassword = generatePassword();
        reviewer.password = await bcrypt.hash(newPassword, 10);
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

        const isNonReview = role === 'manager' || role === 'scrum_master';
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

        const isNonReview = role === 'manager' || role === 'scrum_master';
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

      case 'delete-review': {
        const id = interaction.options.getString('id');
        const review = findReviewById(data, id);

        if (!review) {
          return interaction.reply({ embeds: [createErrorEmbed(`Review with ID "${id}" not found`)], ephemeral: true });
        }

        for (const rv of review.reviewers) {
          if (rv.status === 'pending') {
            const reviewer = getReviewerByName(data, rv.name);
            if (reviewer && reviewer.load > 0) {
              reviewer.load--;
            }
          }
        }

        review.status = 'deleted';
        review.deletedBy = user.name;
        review.deletedAt = new Date().toISOString();
        review.updatedAt = new Date().toISOString();
        saveData(data, `Review ${review.id} deleted by ${user.name}`);

        return interaction.reply({
          embeds: [createSuccessEmbed(`Review **${review.id}** (${review.branch}) has been deleted.`)]
        });
      }

      case 'full-approve': {
        const id = interaction.options.getString('id');
        const review = findReviewById(data, id);

        if (!review) {
          return interaction.reply({ embeds: [createErrorEmbed(`Review with ID "${id}" not found`)], ephemeral: true });
        }

        if (review.status === 'deleted') {
          return interaction.reply({ embeds: [createErrorEmbed('Cannot approve a deleted review')], ephemeral: true });
        }

        let approvedCount = 0;
        for (const rv of review.reviewers) {
          if (rv.status !== 'approved') {
            rv.status = 'approved';
            rv.comment = 'Admin full approval';
            rv.respondedAt = new Date().toISOString();
            approvedCount++;
          }
        }

        review.approvalCount = review.reviewers.length;
        review.status = 'approved';
        review.updatedAt = new Date().toISOString();
        saveData(data, `Review ${review.id} fully approved by admin ${user.name}`);

        return interaction.reply({
          embeds: [createSuccessEmbed(`Review **${review.id}** (${review.branch}) has been fully approved by admin. ${approvedCount} reviewer(s) marked as approved.`)]
        });
      }

      case 'reassign': {
        const id = interaction.options.getString('id');
        const review = findReviewById(data, id);

        if (!review) {
          return interaction.reply({ embeds: [createErrorEmbed(`Review with ID "${id}" not found`)], ephemeral: true });
        }

        if (review.status === 'deleted') {
          return interaction.reply({ embeds: [createErrorEmbed('Cannot reassign a deleted review')], ephemeral: true });
        }

        // Decrement load for current pending reviewers
        for (const rv of review.reviewers) {
          if (rv.status === 'pending') {
            const reviewer = getReviewerByName(data, rv.name);
            if (reviewer && reviewer.load > 0) {
              reviewer.load--;
            }
          }
        }

        // Clear current reviewers
        review.reviewers = [];
        review.approvalCount = 0;
        review.status = 'in_review';
        review.updatedAt = new Date().toISOString();

        // Select new reviewers
        const { selectReviewers, incrementReviewerLoads } = require('../utils/reviews');
        const count = data.settings.reviewersPerRequest || 3;
        const newReviewers = selectReviewers(data, review.reviewType, count, review.merger);

        if (newReviewers.length === 0) {
          saveData(data, `Review ${review.id} reviewers cleared by admin ${user.name}`);
          return interaction.reply({
            embeds: [createErrorEmbed('No available reviewers found. All reviewers may be at max load.')]
          });
        }

        review.reviewers = newReviewers;
        incrementReviewerLoads(data, newReviewers);
        saveData(data, `Review ${review.id} reassigned by admin ${user.name}`);

        const reviewerMentions = newReviewers.map(rv => {
          const r = getReviewerByName(data, rv.name);
          return r && r.discordId ? `<@${r.discordId}>` : rv.name;
        }).join(', ');

        return interaction.reply({
          embeds: [createSuccessEmbed(`Review **${review.id}** (${review.branch}) has been reassigned to: ${reviewerMentions}`)]
        });
      }

      case 'restore-review': {
        const id = interaction.options.getString('id');
        const review = findReviewById(data, id);

        if (!review) {
          return interaction.reply({ embeds: [createErrorEmbed(`Review with ID "${id}" not found`)], ephemeral: true });
        }

        if (review.status !== 'deleted') {
          return interaction.reply({ embeds: [createErrorEmbed('Review is not deleted')], ephemeral: true });
        }

        review.status = 'in_review';
        review.deletedBy = null;
        review.deletedAt = null;
        review.updatedAt = new Date().toISOString();
        saveData(data, `Review ${review.id} restored by admin ${user.name}`);

        return interaction.reply({
          embeds: [createSuccessEmbed(`Review **${review.id}** (${review.branch}) has been restored.`)]
        });
      }

      case 'reset-review': {
        const id = interaction.options.getString('id');
        const review = findReviewById(data, id);

        if (!review) {
          return interaction.reply({ embeds: [createErrorEmbed(`Review with ID "${id}" not found`)], ephemeral: true });
        }

        if (review.status === 'deleted') {
          return interaction.reply({ embeds: [createErrorEmbed('Cannot reset a deleted review. Use restore-review first.')], ephemeral: true });
        }

        // Decrement load for pending reviewers
        for (const rv of review.reviewers) {
          if (rv.status === 'pending') {
            const reviewer = getReviewerByName(data, rv.name);
            if (reviewer && reviewer.load > 0) {
              reviewer.load--;
            }
          }
        }

        // Reset all reviewers to pending
        for (const rv of review.reviewers) {
          rv.status = 'pending';
          rv.comment = '';
          rv.respondedAt = null;
        }

        review.approvalCount = 0;
        review.status = 'in_review';
        review.escalation = null;
        review.updatedAt = new Date().toISOString();
        saveData(data, `Review ${review.id} reset to pending by admin ${user.name}`);

        return interaction.reply({
          embeds: [createSuccessEmbed(`Review **${review.id}** (${review.branch}) has been reset to pending state.`)]
        });
      }

      case 'set-deadline': {
        const id = interaction.options.getString('id');
        const deadlineInput = interaction.options.getString('deadline');
        const review = findReviewById(data, id);

        if (!review) {
          return interaction.reply({ embeds: [createErrorEmbed(`Review with ID "${id}" not found`)], ephemeral: true });
        }

        let deadlineDate;
        const daysMatch = deadlineInput.match(/^(\d+)d?$/);
        if (daysMatch) {
          // Days from now
          const days = parseInt(daysMatch[1]);
          deadlineDate = new Date();
          deadlineDate.setDate(deadlineDate.getDate() + days);
        } else {
          // Try parsing as date
          deadlineDate = new Date(deadlineInput);
          if (isNaN(deadlineDate.getTime())) {
            return interaction.reply({ embeds: [createErrorEmbed('Invalid deadline format. Use YYYY-MM-DD or number of days (e.g., 3 or 3d)')], ephemeral: true });
          }
        }

        review.deadlineAt = deadlineDate.toISOString();
        review.updatedAt = new Date().toISOString();
        saveData(data, `Review ${review.id} deadline set by admin ${user.name}`);

        return interaction.reply({
          embeds: [createSuccessEmbed(`Review **${review.id}** (${review.branch}) deadline set to **${deadlineDate.toLocaleDateString()}**`)]
        });
      }

      case 'broadcast': {
        const message = interaction.options.getString('message');
        const reviewers = data.reviewers.filter(r => r.discordId && !r.disabled);

        if (reviewers.length === 0) {
          return interaction.reply({ embeds: [createErrorEmbed('No linked reviewers to broadcast to')], ephemeral: true });
        }

        const mentions = reviewers.map(r => `<@${r.discordId}>`).join(' ');
        return interaction.reply({
          content: `${mentions}\n\n📢 **Admin Broadcast:** ${message}`
        });
      }

      case 'git-pull': {
        await interaction.deferReply({ ephemeral: true });
        try {
          const projectRoot = path.resolve(__dirname, '../..');
          const { stdout } = await new Promise((resolve, reject) => {
            exec('git pull origin dashboard-remote', { cwd: projectRoot }, (err, stdout, stderr) => {
              if (err) reject(new Error(stderr || err.message));
              else resolve({ stdout });
            });
          });
          const hasChanges = !stdout.includes('Already up to date');
          await interaction.editReply({
            content: `\`\`\`\n${stdout.trim()}\n\`\`\`\n${hasChanges ? '🔄 Changes detected — restarting…' : '✅ Already up to date.'}`
          });
          if (hasChanges) setTimeout(() => process.exit(0), 1000);
        } catch (err) {
          await interaction.editReply({
            content: `❌ Git pull failed:\n\`\`\`\n${err.message}\n\`\`\``
          });
        }
        break;
      }
    }
  }
};
