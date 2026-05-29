const { EmbedBuilder } = require('discord.js');
const { loadData, getReviewerByDiscordId } = require('./data');

function formatStatus(status) {
  const map = {
    in_review: 'In Review',
    fix_needed: 'Fix Needed',
    fix_made: 'Fix Made',
    escalated: 'Escalated',
    approved: 'Approved',
    rejected: 'Rejected',
    deleted: 'Deleted',
    pending: 'Pending'
  };
  return map[status] || status;
}

function statusColor(status) {
  const colors = {
    in_review: 0x3B82F6,
    fix_needed: 0xF59E0B,
    fix_made: 0x8B5CF6,
    escalated: 0xEF4444,
    approved: 0x10B981,
    rejected: 0xDC2626,
    deleted: 0x6B7280,
    pending: 0xF59E0B
  };
  return colors[status] || 0x6B7280;
}

function priorityLabel(priority) {
  const map = { low: 'Low', mid: 'Mid', imp: 'Important' };
  return map[priority] || priority;
}

function priorityEmoji(priority) {
  const map = { low: '🟢', mid: '🟡', imp: '🔴' };
  return map[priority] || '';
}

function getReviewerMention(reviewerName) {
  const data = loadData();
  const reviewer = data.reviewers.find(r => r.name.toLowerCase() === reviewerName.toLowerCase());
  if (reviewer && reviewer.discordId) {
    return `<@${reviewer.discordId}>`;
  }
  return reviewerName;
}

function createReviewEmbed(review, showMentions = false) {
  const reviewersText = review.reviewers.map(rv => {
    const mention = showMentions ? getReviewerMention(rv.name) : rv.name;
    const statusEmoji = rv.status === 'approved' ? '✅' : rv.status === 'disapproved' ? '❌' : '⏳';
    const comment = rv.comment ? ` - ${rv.comment}` : '';
    return `${mention} ${statusEmoji} ${rv.status}${comment}`;
  }).join('\n');

  const title = review.commitRef
    ? `Review: \`${review.commitRef}\``
    : `Review: ${review.branch}`;

  const fields = [
    { name: 'Merger', value: review.merger, inline: true },
    { name: 'Type', value: review.reviewType, inline: true },
    { name: 'Priority', value: `${priorityEmoji(review.priority)} ${priorityLabel(review.priority)}`, inline: true },
    { name: 'Status', value: formatStatus(review.status), inline: true },
    { name: 'Approvals', value: `${review.approvalCount}/${review.reviewers.length}`, inline: true },
    { name: 'Created', value: new Date(review.createdAt).toLocaleString(), inline: true },
    { name: 'Reviewers', value: reviewersText || 'None assigned' }
  ];

  if (review.commitRef) {
    fields.splice(1, 0, { name: 'Branch', value: review.branch, inline: true }, { name: 'Commit', value: `\`${review.commitRef}\``, inline: true });
  }

  return new EmbedBuilder()
    .setTitle(title)
    .setColor(statusColor(review.status))
    .addFields(fields)
    .setFooter({ text: `ID: ${review.id}` })
    .setTimestamp(new Date(review.updatedAt));
}

function createReviewersEmbed(reviewers, settings) {
  const maxLoad = settings.maxLoad || 3;
  const embed = new EmbedBuilder()
    .setTitle('Reviewers')
    .setColor(0x3B82F6);

  let description = '';
  reviewers.sort((a, b) => a.name.localeCompare(b.name)).forEach(r => {
    const isReviewable = r.role === 'reviewer' || r.role === 'senior';
    const loadBar = isReviewable
      ? '🟩'.repeat(r.load) + '⬜'.repeat(maxLoad - r.load)
      : 'N/A';
    description += `**${r.name}** (${r.role})\n${r.speciality} | Load: ${loadBar} (${r.load}/${maxLoad})\n\n`;
  });

  embed.setDescription(description);
  return embed;
}

function createActiveReviewsEmbed(reviews) {
  const embed = new EmbedBuilder()
    .setTitle('Active Reviews')
    .setColor(0x3B82F6);

  if (reviews.length === 0) {
    embed.setDescription('No active reviews');
    return embed;
  }

  let description = '';
  reviews.forEach(r => {
    description += `${priorityEmoji(r.priority)} **${r.branch}** - ${formatStatus(r.status)}\n`;
    description += `Merger: ${r.merger} | ${r.approvalCount}/${r.reviewers.length} approvals\n`;
    description += `ID: \`${r.id}\`\n\n`;
  });

  embed.setDescription(description);
  return embed;
}

function createHistoryEmbed(reviews) {
  const embed = new EmbedBuilder()
    .setTitle('Review History (Last 30 Days)')
    .setColor(0x6B7280);

  if (reviews.length === 0) {
    embed.setDescription('No review history in the last 30 days');
    return embed;
  }

  let description = '';
  reviews.slice(0, 10).forEach(r => {
    description += `${priorityEmoji(r.priority)} **${r.branch}** - ${formatStatus(r.status)}\n`;
    description += `Merger: ${r.merger} | ${new Date(r.createdAt).toLocaleDateString()}\n\n`;
  });

  if (reviews.length > 10) {
    description += `...and ${reviews.length - 10} more`;
  }

  embed.setDescription(description);
  return embed;
}

function createPasswordsEmbed(passwords) {
  const embed = new EmbedBuilder()
    .setTitle('User Passwords')
    .setColor(0xF59E0B)
    .setDescription('⚠️ This information is sensitive. Do not share.');

  let description = '';
  passwords.forEach(p => {
    description += `**${p.name}** (${p.role})\nPassword: \`${p.plainPassword}\`\n\n`;
  });

  embed.setDescription(description);
  return embed;
}

function createErrorEmbed(message) {
  return new EmbedBuilder()
    .setTitle('Error')
    .setColor(0xEF4444)
    .setDescription(message);
}

function createSuccessEmbed(message) {
  return new EmbedBuilder()
    .setTitle('Success')
    .setColor(0x10B981)
    .setDescription(message);
}

function createAuditLogEmbed(entries) {
  const embed = new EmbedBuilder()
    .setTitle('Audit Log (Recent Activity)')
    .setColor(0x6B7280);

  if (entries.length === 0) {
    embed.setDescription('No recent activity.');
    return embed;
  }

  let description = '';
  entries.forEach(e => {
    const date = new Date(e.timestamp).toLocaleString();
    description += `**${date}**\n${e.details || e.action}`;
    if (e.user) description += ` — ${e.user}`;
    description += '\n\n';
  });

  embed.setDescription(description);
  return embed;
}

module.exports = {
  formatStatus,
  statusColor,
  priorityLabel,
  priorityEmoji,
  getReviewerMention,
  createReviewEmbed,
  createReviewersEmbed,
  createActiveReviewsEmbed,
  createHistoryEmbed,
  createPasswordsEmbed,
  createErrorEmbed,
  createSuccessEmbed,
  createAuditLogEmbed
};
