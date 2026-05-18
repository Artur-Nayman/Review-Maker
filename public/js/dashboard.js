let currentUser = null;

document.addEventListener('DOMContentLoaded', () => {
  const stored = localStorage.getItem('reviewMakerUser');
  if (!stored) {
    window.location.href = '/login.html';
    return;
  }

  currentUser = JSON.parse(stored);
  document.getElementById('user-name').textContent = currentUser.name;

  const roleBadge = document.getElementById('user-role');
  roleBadge.textContent = currentUser.role.replace('_', ' ');
  roleBadge.className = `role-badge ${currentUser.role}`;

  if (currentUser.role === 'admin') {
    document.querySelector('.admin-only').style.display = 'block';
  }

  setupTabs();
  setupNewReviewForm();
  setupAdminForms();
  loadReviewers();
  loadReviews();
});

document.getElementById('logout-btn').addEventListener('click', () => {
  localStorage.removeItem('reviewMakerUser');
  window.location.href = '/login.html';
});

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');

      if (btn.dataset.tab === 'active-reviews') loadReviews();
      if (btn.dataset.tab === 'my-reviews') loadMyReviews();
      if (btn.dataset.tab === 'reviewers') loadReviewers();
      if (btn.dataset.tab === 'history') loadReviews();
      if (btn.dataset.tab === 'admin') loadAdminData();
    });
  });
}

function setupNewReviewForm() {
  document.getElementById('new-review-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('review-error');
    errorEl.style.display = 'none';

    const branch = document.getElementById('branch-name').value.trim();
    const reviewType = document.getElementById('review-type').value;
    const priority = document.getElementById('priority').value;

    try {
      const review = await API.createReview(branch, currentUser.name, reviewType, priority);

      document.getElementById('created-review').style.display = 'block';
      document.getElementById('created-review-details').innerHTML = `
        <div class="review-detail-row">
          <span class="review-detail-label">Branch</span>
          <span class="review-detail-value">${review.branch}</span>
        </div>
        <div class="review-detail-row">
          <span class="review-detail-label">Reviewers</span>
          <span class="review-detail-value">${review.reviewers.map(r => r.name).join(', ')}</span>
        </div>
        <div class="review-detail-row">
          <span class="review-detail-label">Type</span>
          <span class="review-detail-value">${review.reviewType}</span>
        </div>
        <div class="review-detail-row">
          <span class="review-detail-label">Priority</span>
          <span class="review-detail-value"><span class="priority-badge ${review.priority}">${review.priority}</span></span>
        </div>
      `;

      document.getElementById('new-review-form').reset();
      loadReviewers();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
    }
  });
}

async function loadReviewers() {
  try {
    const reviewers = await API.getReviewers();
    const tbody = document.getElementById('reviewers-body');
    tbody.innerHTML = '';

    reviewers.sort((a, b) => a.name.localeCompare(b.name));

    reviewers.forEach(r => {
      const maxLoad = 3;
      const dots = Array.from({ length: maxLoad }, (_, i) => {
        let cls = 'load-dot';
        if (i < r.load) {
          cls += ' filled';
          if (r.load >= maxLoad) cls += ' full';
          else if (r.load >= maxLoad - 1) cls += ' warn';
        }
        return `<div class="${cls}"></div>`;
      }).join('');

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${r.name}</strong></td>
        <td>${r.speciality}</td>
        <td><span class="role-badge ${r.role}">${r.role.replace('_', ' ')}</span></td>
        <td>
          <div class="load-bar">
            ${dots}
            <span class="load-text">${r.load}/${maxLoad}</span>
          </div>
        </td>
        <td>${r.load >= maxLoad ? '<span class="status-badge pending">Full</span>' : '<span class="status-badge approved">Available</span>'}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load reviewers:', err);
  }
}

async function loadReviews() {
  try {
    const { active, history } = await API.getReviews();
    renderActiveReviews(active);
    renderHistory(history);
  } catch (err) {
    console.error('Failed to load reviews:', err);
  }
}

function renderActiveReviews(reviews) {
  const tbody = document.getElementById('active-reviews-body');
  const emptyState = document.getElementById('no-active-reviews');
  tbody.innerHTML = '';

  if (reviews.length === 0) {
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';

  reviews.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><code>${r.branch}</code></td>
      <td>${r.merger}</td>
      <td>${r.reviewers.map(rv => `<span class="reviewer-status ${rv.status}">${rv.name} (${rv.status})</span>`).join(' ')}</td>
      <td>${r.approvalCount}/${r.reviewers.length}</td>
      <td><span class="status-badge ${r.status}">${formatStatus(r.status)}</span></td>
      <td><span class="priority-badge ${r.priority}">${r.priority}</span></td>
      <td>
        <button class="btn btn-sm btn-secondary" onclick="openReviewModal('${r.id}')">Details</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function loadMyReviews() {
  try {
    const { active } = await API.getReviews();
    const myReviews = active.filter(r =>
      r.merger.toLowerCase() === currentUser.name.toLowerCase() ||
      r.reviewers.some(rv => rv.name.toLowerCase() === currentUser.name.toLowerCase())
    );

    const tbody = document.getElementById('my-reviews-body');
    const emptyState = document.getElementById('no-my-reviews');
    tbody.innerHTML = '';

    if (myReviews.length === 0) {
      emptyState.style.display = 'block';
      return;
    }

    emptyState.style.display = 'none';

    myReviews.forEach(r => {
      const isMerger = r.merger.toLowerCase() === currentUser.name.toLowerCase();
      const myReviewer = r.reviewers.find(rv => rv.name.toLowerCase() === currentUser.name.toLowerCase());
      const myRole = isMerger ? 'Merger' : (myReviewer ? `Reviewer (${myReviewer.status})` : '');

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code>${r.branch}</code></td>
        <td>${myRole}</td>
        <td>${r.reviewers.map(rv => `<span class="reviewer-status ${rv.status}">${rv.name}</span>`).join(' ')}</td>
        <td>${r.approvalCount}/${r.reviewers.length}</td>
        <td><span class="status-badge ${r.status}">${formatStatus(r.status)}</span></td>
        <td><span class="priority-badge ${r.priority}">${r.priority}</span></td>
        <td>
          <button class="btn btn-sm btn-secondary" onclick="openReviewModal('${r.id}')">Details</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load my reviews:', err);
  }
}

function renderHistory(reviews) {
  const tbody = document.getElementById('history-body');
  const emptyState = document.getElementById('no-history');
  tbody.innerHTML = '';

  if (reviews.length === 0) {
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';

  reviews.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><code>${r.branch}</code></td>
      <td>${r.merger}</td>
      <td>${r.reviewers.map(rv => rv.name).join(', ')}</td>
      <td><span class="status-badge ${r.status}">${formatStatus(r.status)}</span></td>
      <td><span class="priority-badge ${r.priority}">${r.priority}</span></td>
      <td>${new Date(r.createdAt).toLocaleDateString()}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function openReviewModal(id) {
  try {
    const review = await API.getReview(id);
    const modal = document.getElementById('review-modal');
    const title = document.getElementById('modal-title');
    const body = document.getElementById('modal-body');

    title.textContent = review.branch;

    let actionsHTML = '';
    const isMerger = review.merger.toLowerCase() === currentUser.name.toLowerCase();
    const myReviewer = review.reviewers.find(rv => rv.name.toLowerCase() === currentUser.name.toLowerCase());
    const isSenior = currentUser.role === 'senior';
    const isEscalated = review.status === 'escalated';

    if (myReviewer && myReviewer.status === 'pending' && (review.status === 'in_review' || review.status === 'fix_made')) {
      actionsHTML += `
        <button class="btn btn-sm btn-success" onclick="approveReview('${id}')">Approve</button>
        <button class="btn btn-sm btn-warning" onclick="promptDisapprove('${id}')">Disapprove</button>
      `;
    }

    if (isMerger && review.status === 'fix_needed') {
      actionsHTML += `
        <button class="btn btn-sm btn-primary" onclick="markFixDone('${id}')">Fixes Done</button>
        <button class="btn btn-sm btn-danger" onclick="promptEscalate('${id}')">Disagree & Escalate</button>
      `;
    }

    if (isEscalated && isSenior && review.escalation?.assignedTo?.toLowerCase() === currentUser.name.toLowerCase()) {
      actionsHTML += `
        <button class="btn btn-sm btn-success" onclick="escalationDecide('${id}', 'approve')">Approve</button>
        <button class="btn btn-sm btn-danger" onclick="escalationDecide('${id}', 'reject')">Reject</button>
      `;
    }

    let commentsHTML = '';
    if (review.comments && review.comments.length > 0) {
      commentsHTML = `
        <h4 style="margin-top: 1rem; margin-bottom: 0.5rem;">Comments</h4>
        ${review.comments.map(c => `
          <div class="comment-item">
            <div class="comment-author">${c.author}</div>
            <div class="comment-text">${c.text}</div>
            <div class="comment-time">${new Date(c.createdAt).toLocaleString()}</div>
          </div>
        `).join('')}
      `;
    }

    let escalationHTML = '';
    if (review.escalation) {
      escalationHTML = `
        <div class="card" style="background: rgba(239, 68, 68, 0.1); border-color: var(--danger); margin-top: 1rem;">
          <h4 style="color: var(--danger);">Escalation</h4>
          <div class="review-detail-row">
            <span class="review-detail-label">Requested by</span>
            <span class="review-detail-value">${review.escalation.requestedBy}</span>
          </div>
          <div class="review-detail-row">
            <span class="review-detail-label">Assigned to</span>
            <span class="review-detail-value">${review.escalation.assignedTo}</span>
          </div>
          <div class="review-detail-row">
            <span class="review-detail-label">Reason</span>
            <span class="review-detail-value">${review.escalation.reason || 'N/A'}</span>
          </div>
          ${review.escalation.decision ? `
            <div class="review-detail-row">
              <span class="review-detail-label">Decision</span>
              <span class="review-detail-value"><span class="status-badge ${review.escalation.decision === 'approve' ? 'approved' : 'rejected'}">${review.escalation.decision}</span></span>
            </div>
          ` : ''}
        </div>
      `;
    }

    body.innerHTML = `
      <div class="review-detail-row">
        <span class="review-detail-label">Merger</span>
        <span class="review-detail-value">${review.merger}</span>
      </div>
      <div class="review-detail-row">
        <span class="review-detail-label">Review Type</span>
        <span class="review-detail-value">${review.reviewType}</span>
      </div>
      <div class="review-detail-row">
        <span class="review-detail-label">Priority</span>
        <span class="review-detail-value"><span class="priority-badge ${review.priority}">${review.priority}</span></span>
      </div>
      <div class="review-detail-row">
        <span class="review-detail-label">Status</span>
        <span class="review-detail-value"><span class="status-badge ${review.status}">${formatStatus(review.status)}</span></span>
      </div>
      <div class="review-detail-row">
        <span class="review-detail-label">Approvals</span>
        <span class="review-detail-value">${review.approvalCount}/${review.reviewers.length}</span>
      </div>
      <div class="review-detail-row">
        <span class="review-detail-label">Reviewers</span>
        <span class="review-detail-value">${review.reviewers.map(rv => `<span class="reviewer-status ${rv.status}">${rv.name} (${rv.status})${rv.comment ? ': ' + rv.comment : ''}</span>`).join(' ')}</span>
      </div>
      <div class="review-detail-row">
        <span class="review-detail-label">Created</span>
        <span class="review-detail-value">${new Date(review.createdAt).toLocaleString()}</span>
      </div>

      ${escalationHTML}

      <div style="margin-top: 1rem;">
        <h4 style="margin-bottom: 0.5rem;">Add Comment</h4>
        <div class="form-row" style="margin-bottom: 0;">
          <div class="form-group" style="flex: 1;">
            <textarea id="comment-text" placeholder="Add a comment..." style="width: 100%; background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius); padding: 0.625rem; color: var(--text); resize: vertical; min-height: 60px;"></textarea>
          </div>
        </div>
        <button class="btn btn-sm btn-secondary" style="margin-top: 0.5rem;" onclick="addComment('${id}')">Post Comment</button>
      </div>

      ${commentsHTML}

      ${actionsHTML ? `<div class="action-bar">${actionsHTML}</div>` : ''}
    `;

    modal.style.display = 'flex';
  } catch (err) {
    console.error('Failed to load review:', err);
  }
}

function closeModal() {
  document.getElementById('review-modal').style.display = 'none';
}

document.querySelector('.modal-backdrop')?.addEventListener('click', closeModal);

async function approveReview(id) {
  try {
    await API.approveReview(id, currentUser.name);
    closeModal();
    loadReviews();
    loadReviewers();
    loadMyReviews();
  } catch (err) {
    alert(err.message);
  }
}

function promptDisapprove(id) {
  const comment = prompt('Reason for disapproval:');
  if (comment !== null) {
    API.disapproveReview(id, currentUser.name, comment)
      .then(() => {
        closeModal();
        loadReviews();
        loadReviewers();
        loadMyReviews();
      })
      .catch(err => alert(err.message));
  }
}

async function markFixDone(id) {
  if (!confirm('Mark fixes as done? This will re-assign reviewers.')) return;
  try {
    await API.markFixDone(id);
    closeModal();
    loadReviews();
    loadReviewers();
    loadMyReviews();
  } catch (err) {
    alert(err.message);
  }
}

function promptEscalate(id) {
  const reason = prompt('Reason for escalation:');
  if (reason !== null) {
    API.escalateReview(id, currentUser.name, reason)
      .then(() => {
        closeModal();
        loadReviews();
        loadMyReviews();
      })
      .catch(err => alert(err.message));
  }
}

async function escalationDecide(id, decision) {
  if (!confirm(`Are you sure you want to ${decision} this review?`)) return;
  try {
    await API.escalationDecide(id, currentUser.name, decision);
    closeModal();
    loadReviews();
    loadReviewers();
    loadMyReviews();
  } catch (err) {
    alert(err.message);
  }
}

async function addComment(id) {
  const text = document.getElementById('comment-text').value.trim();
  if (!text) return;
  try {
    await API.addComment(id, currentUser.name, text);
    openReviewModal(id);
  } catch (err) {
    alert(err.message);
  }
}

function setupAdminForms() {
  document.getElementById('role-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('role-user-select').value;
    const role = document.getElementById('role-select').value;
    try {
      await API.updateRole(name, role);
      alert('Role updated');
      loadAdminData();
      loadReviewers();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('add-reviewer-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('add-name').value.trim();
    const speciality = document.getElementById('add-speciality').value;
    const role = document.getElementById('add-role').value;
    try {
      await API.addReviewer(name, speciality, role);
      alert('Reviewer added');
      document.getElementById('add-reviewer-form').reset();
      loadAdminData();
      loadReviewers();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('remove-reviewer-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('remove-user-select').value;
    if (!confirm(`Remove ${name}?`)) return;
    try {
      await API.removeReviewer(name);
      alert('Reviewer removed');
      loadAdminData();
      loadReviewers();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('csv-import-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fileInput = document.getElementById('csv-file');
    if (!fileInput.files.length) {
      alert('Select a CSV file');
      return;
    }

    const file = fileInput.files[0];
    const text = await file.text();

    if (!confirm('This will replace all reviewers (except admin/senior/scrum_master). Continue?')) return;

    try {
      await API.importCSV(text);
      alert('CSV imported');
      loadAdminData();
      loadReviewers();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const reviewersPerRequest = parseInt(document.getElementById('setting-reviewers').value);
    const maxLoad = parseInt(document.getElementById('setting-max-load').value);
    try {
      await API.updateSettings({ reviewersPerRequest, maxLoad });
      alert('Settings saved');
    } catch (err) {
      alert(err.message);
    }
  });
}

async function loadAdminData() {
  try {
    const reviewers = await API.getReviewers();
    const settings = await API.getSettings();

    const roleSelect = document.getElementById('role-user-select');
    const removeSelect = document.getElementById('remove-user-select');
    roleSelect.innerHTML = '';
    removeSelect.innerHTML = '';

    reviewers
      .filter(r => r.role !== 'admin')
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(r => {
        const opt1 = document.createElement('option');
        opt1.value = r.name;
        opt1.textContent = `${r.name} (${r.role})`;
        roleSelect.appendChild(opt1);

        const opt2 = document.createElement('option');
        opt2.value = r.name;
        opt2.textContent = r.name;
        removeSelect.appendChild(opt2);
      });

    document.getElementById('setting-reviewers').value = settings.reviewersPerRequest || 3;
    document.getElementById('setting-max-load').value = settings.maxLoad || 3;
  } catch (err) {
    console.error('Failed to load admin data:', err);
  }
}

function formatStatus(status) {
  const map = {
    in_review: 'In Review',
    fix_needed: 'Fix Needed',
    fix_made: 'Fix Made',
    escalated: 'Escalated',
    approved: 'Approved',
    rejected: 'Rejected',
    pending: 'Pending'
  };
  return map[status] || status;
}
