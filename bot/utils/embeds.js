const { EmbedBuilder } = require('discord.js');
const { loadData, getReviewerByDiscordId, getReviewerCapacity } = require('./data');

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

function sizeEmoji(size) {
  const map = { small: '🟢', medium: '🟡', large: '🔴' };
  return map[size] || '⚪';
}

function reviewTypeLabel(type) {
  return type === 'commit' ? '📝 Commit' : '🌿 Branch';
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

  const commitsText = review.commits && review.commits.length > 0
    ? review.commits.map(c => `\`${c}\``).join(', ')
    : '—';

  return new EmbedBuilder()
    .setTitle(`Review: ${review.branch}`)
    .setColor(statusColor(review.status))
    .addFields(
      { name: 'Merger', value: review.merger, inline: true },
      { name: 'Type', value: `${reviewTypeLabel(review.reviewType)} ${sizeEmoji(review.size)} ${review.size}`, inline: true },
      { name: 'Priority', value: `${priorityEmoji(review.priority)} ${priorityLabel(review.priority)}`, inline: true },
      { name: 'Status', value: formatStatus(review.status), inline: true },
      { name: 'Approvals', value: `${review.approvalCount}/${review.reviewers.length}`, inline: true },
      { name: 'Created', value: new Date(review.createdAt).toLocaleString(), inline: true },
      { name: 'Commits', value: commitsText, inline: false },
      { name: 'Reviewers', value: reviewersText || 'None assigned' }
    )
    .setFooter({ text: `ID: ${review.id}` })
    .setTimestamp(new Date(review.updatedAt));
}

function createReviewersEmbed(reviewers, settings) {
  const data = loadData();
  const embed = new EmbedBuilder()
    .setTitle('Reviewers')
    .setColor(0x3B82F6);

  let description = '';
  reviewers.sort((a, b) => a.name.localeCompare(b.name)).forEach(r => {
    const isReviewable = r.role === 'reviewer' || r.role === 'senior';
    let info;
    if (isReviewable) {
      const cap = getReviewerCapacity(data, r);
      const loadBar = '🟩'.repeat(r.load) + '⬜'.repeat(Math.max(0, 5 - r.load));
      const largeIcon = r.currentLargeReview ? ' 🔴L' : ' 🟢';
      info = `Load: ${loadBar} (${r.load})\nWeekly: ${r.weeklyCount}/${cap.maxWeekly}${largeIcon}`;
    } else {
      info = 'N/A';
    }
    description += `**${r.name}** (${r.role})\n${r.speciality} | ${info}\n\n`;
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
    const sizeIcon = sizeEmoji(r.size);
    description += `${priorityEmoji(r.priority)} ${sizeIcon} **${r.branch}** - ${formatStatus(r.status)}\n`;
    description += `Merger: ${r.merger} | ${r.approvalCount}/${r.reviewers.length} approvals | ${reviewTypeLabel(r.reviewType)} ${r.size}\n`;
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
    description += `${priorityEmoji(r.priority)} ${sizeEmoji(r.size)} **${r.branch}** - ${formatStatus(r.status)}\n`;
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

function createWorkloadEmbed(reviewers, settings) {
  const data = loadData();
  const embed = new EmbedBuilder()
    .setTitle('📊 Reviewer Workload')
    .setColor(0x3B82F6);

  let description = '```\n';
  description += 'Name               Load  Wkly  Cap  Large  Role\n';
  description += '─'.repeat(52) + '\n';
  reviewers.sort((a, b) => a.name.localeCompare(b.name)).forEach(r => {
    const cap = getReviewerCapacity(data, r);
    const largeIcon = r.currentLargeReview ? 'YES' : 'no ';
    const name = r.name.padEnd(18).slice(0, 18);
    description += `${name} ${String(r.load).padStart(4)}  ${String(r.weeklyCount).padStart(4)}  ${String(cap.maxWeekly).padStart(3)}  ${largeIcon}  ${r.role}\n`;
  });
  description += '```';

  embed.setDescription(description);
  return embed;
}

function createDashboardEmbed(data) {
  const activeCount = data.reviews.filter(r => ['in_review', 'fix_needed', 'fix_made', 'escalated'].includes(r.status)).length;
  const totalReviewers = data.reviewers.length;
  const reviewableReviewers = data.reviewers.filter(r => r.role === 'reviewer' || r.role === 'senior');
  const availableReviewers = reviewableReviewers.filter(r => {
    const cap = getReviewerCapacity(data, r);
    return cap.weeklyRemaining > 0;
  });

  const weeksReviews = data.reviews.filter(r => {
    const created = new Date(r.createdAt);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return created >= weekAgo;
  });

  const approvedThisWeek = weeksReviews.filter(r => r.status === 'approved').length;
  const rejectedThisWeek = weeksReviews.filter(r => r.status === 'rejected').length;

  const embed = new EmbedBuilder()
    .setTitle('📋 Review Dashboard')
    .setColor(0x3B82F6)
    .addFields(
      { name: 'Active Reviews', value: String(activeCount), inline: true },
      { name: 'Total Reviewers', value: String(totalReviewers), inline: true },
      { name: 'Available (weekly cap)', value: `${availableReviewers.length}/${reviewableReviewers.length}`, inline: true },
      { name: 'Reviews This Week', value: String(weeksReviews.length), inline: true },
      { name: 'Approved This Week', value: String(approvedThisWeek), inline: true },
      { name: 'Rejected This Week', value: String(rejectedThisWeek), inline: true }
    );

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
  createWorkloadEmbed,
  createDashboardEmbed,
  createErrorEmbed,
  createSuccessEmbed
};
