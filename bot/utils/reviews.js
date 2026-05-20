const { loadData, saveData, getReviewerByName, isReviewableRole, generateReviewId, findReviewById } = require('./data');

function selectReviewers(data, reviewType, count, excludeName) {
  const maxLoad = data.settings.maxLoad || 3;
  const available = data.reviewers.filter(r =>
    isReviewableRole(r.role) &&
    r.load < maxLoad &&
    r.name.toLowerCase() !== excludeName?.toLowerCase()
  );

  if (available.length === 0) return [];

  const matchingSpecialty = available.filter(r =>
    r.speciality.toLowerCase() === reviewType.toLowerCase() ||
    r.speciality.toLowerCase() === 'fullstack'
  );

  const others = available.filter(r => !matchingSpecialty.includes(r));

  matchingSpecialty.sort((a, b) => a.load - b.load);
  others.sort((a, b) => a.load - b.load);

  const selected = [];
  for (const r of [...matchingSpecialty, ...others]) {
    if (selected.length >= count) break;
    selected.push({ name: r.name, status: 'pending', notified: false });
  }

  return selected;
}

function incrementReviewerLoads(data, reviewers) {
  for (const rv of reviewers) {
    const reviewer = getReviewerByName(data, rv.name);
    if (reviewer) reviewer.load = Math.min(reviewer.load + 1, data.settings.maxLoad || 3);
  }
}

function decrementReviewerLoad(data, name) {
  const reviewer = getReviewerByName(data, name);
  if (reviewer) reviewer.load = Math.max(reviewer.load - 1, 0);
}

function getSeniorReviewer(data) {
  return data.reviewers.find(r => r.role === 'senior');
}

function createReview(branch, merger, reviewType, priority) {
  const data = loadData();
  const count = data.settings.reviewersPerRequest || 3;
  const reviewers = selectReviewers(data, reviewType, count, merger);

  if (reviewers.length === 0) {
    throw new Error('No available reviewers (all at max load)');
  }

  incrementReviewerLoads(data, reviewers);

  const review = {
    id: generateReviewId(data),
    branch,
    merger,
    reviewers,
    approvalCount: 0,
    status: 'in_review',
    priority,
    reviewType,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    escalation: null,
    comments: []
  };

  data.reviews.push(review);
  saveData(data, `Review ${review.id} created: ${branch}`);

  return review;
}

function approveReview(id, reviewerName) {
  const data = loadData();
  const review = findReviewById(data, id);

  if (!review) throw new Error('Review not found');
  if (review.status !== 'in_review' && review.status !== 'fix_made') {
    throw new Error('Review is not in a reviewable state');
  }

  const rv = review.reviewers.find(r => r.name.toLowerCase() === reviewerName.toLowerCase());
  if (!rv) throw new Error('Reviewer not found on this review');
  if (rv.status !== 'pending') throw new Error('Reviewer already responded');

  rv.status = 'approved';
  rv.respondedAt = new Date().toISOString();
  review.approvalCount++;
  review.updatedAt = new Date().toISOString();

  decrementReviewerLoad(data, reviewerName);

  if (review.approvalCount >= data.settings.reviewersPerRequest) {
    review.status = 'approved';
  }

  saveData(data, `Review ${id} approved by ${reviewerName}`);
  return review;
}

function disapproveReview(id, reviewerName, comment) {
  const data = loadData();
  const review = findReviewById(data, id);

  if (!review) throw new Error('Review not found');
  if (review.status !== 'in_review' && review.status !== 'fix_made') {
    throw new Error('Review is not in a reviewable state');
  }

  const rv = review.reviewers.find(r => r.name.toLowerCase() === reviewerName.toLowerCase());
  if (!rv) throw new Error('Reviewer not found on this review');
  if (rv.status !== 'pending') throw new Error('Reviewer already responded');

  rv.status = 'disapproved';
  rv.comment = comment || '';
  rv.respondedAt = new Date().toISOString();
  review.status = 'fix_needed';
  review.updatedAt = new Date().toISOString();

  decrementReviewerLoad(data, reviewerName);

  saveData(data, `Review ${id} disapproved by ${reviewerName}`);
  return review;
}

function markFixDone(id) {
  const data = loadData();
  const review = findReviewById(data, id);

  if (!review) throw new Error('Review not found');
  if (review.status !== 'fix_needed') {
    throw new Error('Review is not in fix_needed state');
  }

  review.status = 'fix_made';
  review.updatedAt = new Date().toISOString();

  for (const rv of review.reviewers) {
    if (rv.status === 'disapproved') {
      rv.status = 'pending';
      rv.comment = '';
      rv.respondedAt = null;
    }
  }

  saveData(data, `Review ${id} marked fix-done`);
  return review;
}

function escalateReview(id, mergerName, reason, userRole) {
  const data = loadData();
  const review = findReviewById(data, id);

  if (!review) throw new Error('Review not found');
  if (review.status !== 'fix_needed') {
    throw new Error('Can only escalate fix_needed reviews');
  }

  const isMerger = review.merger.toLowerCase() === mergerName.toLowerCase();
  const isScrumMaster = userRole === 'scrum_master';

  if (!isMerger && !isScrumMaster) {
    throw new Error('Only merger or scrum master can escalate');
  }

  const senior = getSeniorReviewer(data);
  if (!senior) {
    throw new Error('No senior reviewer assigned');
  }

  review.status = 'escalated';
  review.escalation = {
    requestedBy: mergerName,
    reason: reason || '',
    assignedTo: senior.name,
    createdAt: new Date().toISOString()
  };
  review.updatedAt = new Date().toISOString();

  saveData(data, `Review ${id} escalated by ${mergerName}`);
  return review;
}

function escalationDecide(id, seniorName, decision) {
  const data = loadData();
  const review = findReviewById(data, id);

  if (!review) throw new Error('Review not found');
  if (review.status !== 'escalated') {
    throw new Error('Review is not escalated');
  }
  if (decision !== 'approve' && decision !== 'reject') {
    throw new Error('Decision must be approve or reject');
  }

  review.status = decision === 'approve' ? 'approved' : 'rejected';
  review.escalation.decidedAt = new Date().toISOString();
  review.escalation.decision = decision;
  review.updatedAt = new Date().toISOString();

  for (const rv of review.reviewers) {
    if (rv.status === 'disapproved') {
      decrementReviewerLoad(data, rv.name);
    }
  }

  saveData(data, `Review ${id} escalation decided: ${decision}`);
  return review;
}

function addComment(id, author, text) {
  const data = loadData();
  const review = findReviewById(data, id);

  if (!review) throw new Error('Review not found');

  review.comments.push({
    author,
    text,
    createdAt: new Date().toISOString()
  });
  review.updatedAt = new Date().toISOString();

  saveData(data, `Comment added to review ${id} by ${author}`);
  return review;
}

function getActiveReviews() {
  const data = loadData();
  return data.reviews.filter(r => ['pending', 'in_review', 'fix_needed', 'fix_made', 'escalated'].includes(r.status));
}

function getReviewHistory() {
  const data = loadData();
  const now = new Date();
  const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());

  return data.reviews.filter(r => {
    const created = new Date(r.createdAt);
    return ['approved', 'rejected', 'deleted'].includes(r.status) && created >= oneMonthAgo;
  });
}

function getReviewById(id) {
  const data = loadData();
  return findReviewById(data, id);
}

module.exports = {
  selectReviewers,
  incrementReviewerLoads,
  decrementReviewerLoad,
  getSeniorReviewer,
  createReview,
  approveReview,
  disapproveReview,
  markFixDone,
  escalateReview,
  escalationDecide,
  addComment,
  getActiveReviews,
  getReviewHistory,
  getReviewById
};
