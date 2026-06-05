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

  if (currentUser.role === 'admin' || currentUser.role === 'manager') {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'block');
  }

  if (currentUser.role === 'admin') {
    document.getElementById('merger-group').style.display = 'flex';
    loadMergerOptions();
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
      if (btn.dataset.tab === 'all-reviews') loadAllReviews();
      if (btn.dataset.tab === 'reviewers') loadReviewers();
      if (btn.dataset.tab === 'history') loadReviews();
      if (btn.dataset.tab === 'data') loadRawData();
      if (btn.dataset.tab === 'admin') loadAdminData();
    });
  });
}

function loadMergerOptions() {
  const select = document.getElementById('merger-select');
  select.innerHTML = '';
  API.getReviewers().then(reviewers => {
    reviewers.sort((a, b) => a.name.localeCompare(b.name));
    reviewers.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.name;
      opt.textContent = r.name;
      if (r.name === currentUser.name) opt.selected = true;
      select.appendChild(opt);
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
    const merger = currentUser.role === 'admin'
      ? document.getElementById('merger-select').value
      : currentUser.name;

    try {
      const review = await API.createReview(branch, merger, reviewType, priority);

      document.getElementById('created-review').style.display = 'block';
      const mergerRow = review.merger !== currentUser.name
        ? `<div class="review-detail-row"><span class="review-detail-label">Merger</span><span class="review-detail-value">${review.merger}</span></div>`
        : '';
      document.getElementById('created-review-details').innerHTML = `
        ${mergerRow}
        <div class="review-detail-row"><span class="review-detail-label">ID</span><span class="review-detail-value"><code>${review.id}</code></span></div>
        <div class="review-detail-row"><span class="review-detail-label">Branch</span><span class="review-detail-value">${review.branch}</span></div>
        <div class="review-detail-row"><span class="review-detail-label">Reviewers</span><span class="review-detail-value">${review.reviewers.map(r => r.name).join(', ')}</span></div>
        <div class="review-detail-row"><span class="review-detail-label">Type</span><span class="review-detail-value">${review.reviewType}</span></div>
        <div class="review-detail-row"><span class="review-detail-label">Priority</span><span class="review-detail-value"><span class="priority-badge ${review.priority}">${review.priority}</span></span></div>
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
      const isReviewable = r.role === 'reviewer' || r.role === 'senior';
      const dots = isReviewable ? Array.from({ length: maxLoad }, (_, i) => {
        let cls = 'load-dot';
        if (i < r.load) { cls += ' filled'; if (r.load >= maxLoad) cls += ' full'; else if (r.load >= maxLoad - 1) cls += ' warn'; }
        return `<div class="${cls}"></div>`;
      }).join('') : '<span style="color: var(--text-muted); font-size: 0.75rem;">N/A</span>';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${r.name}</strong></td>
        <td>${r.speciality}</td>
        <td><span class="role-badge ${r.role}">${r.role.replace('_', ' ')}</span></td>
        <td><div class="load-bar">${dots}${isReviewable ? `<span class="load-text">${r.load}/${maxLoad}</span>` : ''}</div></td>
        <td>${!isReviewable ? '<span style="color: var(--text-muted); font-size: 0.75rem;">Non-reviewer</span>' : (r.load >= maxLoad ? '<span class="status-badge pending">Full</span>' : '<span class="status-badge approved">Available</span>')}</td>
        <td><button class="btn btn-sm btn-primary" onclick="openReviewerEdit('${r.name}')">Edit</button></td>`;
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

  if (reviews.length === 0) { emptyState.style.display = 'block'; return; }
  emptyState.style.display = 'none';

  const canDelete = currentUser.role === 'admin' || currentUser.role === 'manager';
  reviews.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><code>${r.id}</code></td>
      <td><code>${r.branch}</code></td>
      <td>${r.merger}</td>
      <td>${r.reviewers.map(rv => `<span class="reviewer-status ${rv.status}">${rv.name} (${rv.status})</span>`).join(' ')}</td>
      <td>${r.approvalCount}/${r.reviewers.length}</td>
      <td><span class="status-badge ${r.status}">${formatStatus(r.status)}</span></td>
      <td><span class="priority-badge ${r.priority}">${r.priority}</span></td>
      <td>
        <button class="btn btn-sm btn-secondary" onclick="openReviewModal('${r.id}')">Details</button>
        ${canDelete ? `<button class="btn btn-sm btn-danger" onclick="deleteReview('${r.id}')">Delete</button>` : ''}
      </td>`;
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

    if (myReviews.length === 0) { emptyState.style.display = 'block'; return; }
    emptyState.style.display = 'none';

    myReviews.forEach(r => {
      const isMerger = r.merger.toLowerCase() === currentUser.name.toLowerCase();
      const myReviewer = r.reviewers.find(rv => rv.name.toLowerCase() === currentUser.name.toLowerCase());
      const myRole = isMerger ? 'Merger' : (myReviewer ? `Reviewer (${myReviewer.status})` : '');

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code>${r.id}</code></td>
        <td><code>${r.branch}</code></td>
        <td>${myRole}</td>
        <td>${r.reviewers.map(rv => `<span class="reviewer-status ${rv.status}">${rv.name}</span>`).join(' ')}</td>
        <td>${r.approvalCount}/${r.reviewers.length}</td>
        <td><span class="status-badge ${r.status}">${formatStatus(r.status)}</span></td>
        <td><span class="priority-badge ${r.priority}">${r.priority}</span></td>
        <td><button class="btn btn-sm btn-secondary" onclick="openReviewModal('${r.id}')">Details</button></td>`;
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

  if (reviews.length === 0) { emptyState.style.display = 'block'; return; }
  emptyState.style.display = 'none';

  const canDelete = currentUser.role === 'admin' || currentUser.role === 'manager';
  reviews.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><code>${r.id}</code></td>
      <td><code>${r.branch}</code></td>
      <td>${r.merger}</td>
      <td>${r.reviewers.map(rv => rv.name).join(', ')}</td>
      <td><span class="status-badge ${r.status}">${formatStatus(r.status)}</span></td>
      <td><span class="priority-badge ${r.priority}">${r.priority}</span></td>
      <td>${new Date(r.createdAt).toLocaleDateString()}</td>
      <td>
        <button class="btn btn-sm btn-secondary" onclick="openReviewModal('${r.id}')">View</button>
        ${canDelete ? `<button class="btn btn-sm btn-danger" onclick="deleteReview('${r.id}')">Delete</button>` : ''}
      </td>`;
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

    const isActive = ['pending', 'in_review', 'fix_needed', 'fix_made', 'escalated'].includes(review.status);
    const isMerger = review.merger.toLowerCase() === currentUser.name.toLowerCase();
    const myReviewer = review.reviewers.find(rv => rv.name.toLowerCase() === currentUser.name.toLowerCase());
    const isSenior = currentUser.role === 'senior';
    const isScrumMaster = currentUser.role === 'scrum_master';
    const isEscalated = review.status === 'escalated';
    const canDelete = currentUser.role === 'admin' || currentUser.role === 'manager';

    let actionsHTML = '';
    if (myReviewer && myReviewer.status === 'pending' && (review.status === 'in_review' || review.status === 'fix_made')) {
      actionsHTML += `<button class="btn btn-sm btn-success" onclick="approveReview('${id}')">Approve</button><button class="btn btn-sm btn-warning" onclick="promptDisapprove('${id}')">Disapprove</button>`;
    }
    if (isMerger && review.status === 'fix_needed') {
      actionsHTML += `<button class="btn btn-sm btn-primary" onclick="markFixDone('${id}')">Fixes Done</button><button class="btn btn-sm btn-danger" onclick="promptEscalate('${id}')">Disagree & Escalate</button>`;
    }
    if (isScrumMaster && review.status === 'fix_needed') {
      actionsHTML += `<button class="btn btn-sm btn-danger" onclick="promptEscalate('${id}')">Escalate</button>`;
    }
    if (isEscalated && isSenior && review.escalation?.assignedTo?.toLowerCase() === currentUser.name.toLowerCase()) {
      actionsHTML += `<button class="btn btn-sm btn-success" onclick="escalationDecide('${id}', 'approve')">Approve</button><button class="btn btn-sm btn-danger" onclick="escalationDecide('${id}', 'reject')">Reject</button>`;
    }
    if (canDelete && isActive) {
      actionsHTML += `<button class="btn btn-sm btn-danger" onclick="deleteReview('${id}'); closeModal();">Delete Review</button>`;
    }

    let commentsHTML = '';
    if (review.comments && review.comments.length > 0) {
      commentsHTML = `<h4 style="margin-top: 1rem; margin-bottom: 0.5rem;">Comments</h4>${review.comments.map(c => `<div class="comment-item"><div class="comment-author">${c.author}</div><div class="comment-text">${c.text}</div><div class="comment-time">${new Date(c.createdAt).toLocaleString()}</div></div>`).join('')}`;
    }

    let escalationHTML = '';
    if (review.escalation) {
      escalationHTML = `<div class="card" style="background: rgba(239, 68, 68, 0.1); border-color: var(--danger); margin-top: 1rem;">
        <h4 style="color: var(--danger);">Escalation</h4>
        <div class="review-detail-row"><span class="review-detail-label">Requested by</span><span class="review-detail-value">${review.escalation.requestedBy}</span></div>
        <div class="review-detail-row"><span class="review-detail-label">Assigned to</span><span class="review-detail-value">${review.escalation.assignedTo}</span></div>
        <div class="review-detail-row"><span class="review-detail-label">Reason</span><span class="review-detail-value">${review.escalation.reason || 'N/A'}</span></div>
        ${review.escalation.decision ? `<div class="review-detail-row"><span class="review-detail-label">Decision</span><span class="review-detail-value"><span class="status-badge ${review.escalation.decision === 'approve' ? 'approved' : 'rejected'}">${review.escalation.decision}</span></span></div>` : ''}
      </div>`;
    }

    body.innerHTML = `
      <div class="review-detail-row"><span class="review-detail-label">ID</span><span class="review-detail-value"><code>${review.id}</code></span></div>
      <div class="review-detail-row"><span class="review-detail-label">Merger</span><span class="review-detail-value">${review.merger}</span></div>
      <div class="review-detail-row"><span class="review-detail-label">Review Type</span><span class="review-detail-value">${review.reviewType}</span></div>
      <div class="review-detail-row"><span class="review-detail-label">Priority</span><span class="review-detail-value"><span class="priority-badge ${review.priority}">${review.priority}</span></span></div>
      <div class="review-detail-row"><span class="review-detail-label">Status</span><span class="review-detail-value"><span class="status-badge ${review.status}">${formatStatus(review.status)}</span></span></div>
      <div class="review-detail-row"><span class="review-detail-label">Approvals</span><span class="review-detail-value">${review.approvalCount}/${review.reviewers.length}</span></div>
      <div class="review-detail-row"><span class="review-detail-label">Reviewers</span><span class="review-detail-value">${review.reviewers.map(rv => `<span class="reviewer-status ${rv.status}">${rv.name} (${rv.status})${rv.comment ? ': ' + rv.comment : ''}</span>`).join(' ')}</span></div>
      <div class="review-detail-row"><span class="review-detail-label">Created</span><span class="review-detail-value">${new Date(review.createdAt).toLocaleString()}</span></div>
      ${review.commits?.length ? `<div class="review-detail-row"><span class="review-detail-label">Commits</span><span class="review-detail-value"><code>${review.commits.join(', ')}</code></span></div>` : ''}
      ${review.size ? `<div class="review-detail-row"><span class="review-detail-label">Size</span><span class="review-detail-value">${review.size}</span></div>` : ''}
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
      ${actionsHTML ? `<div class="action-bar">${actionsHTML}</div>` : ''}`;

    modal.style.display = 'flex';
  } catch (err) {
    console.error('Failed to load review:', err);
  }
}

function closeModal() {
  document.getElementById('review-modal').style.display = 'none';
}

document.querySelector('.modal-backdrop')?.addEventListener('click', closeModal);

async function deleteReview(id) {
  if (!confirm(`Delete review ${id}?`)) return;
  try {
    await API.deleteReview(id, currentUser.role, currentUser.name);
    loadReviews();
    loadReviewers();
    loadMyReviews();
    if (typeof loadAllReviews === 'function') loadAllReviews();
  } catch (err) {
    alert(err.message);
  }
}

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
      .then(() => { closeModal(); loadReviews(); loadReviewers(); loadMyReviews(); })
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
    API.escalateReview(id, currentUser.name, reason, currentUser.role)
      .then(() => { closeModal(); loadReviews(); loadMyReviews(); })
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
    } catch (err) { alert(err.message); }
  });

  document.getElementById('load-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('load-user-select').value;
    const load = parseInt(document.getElementById('load-input').value);
    try {
      await API.setLoad(name, load);
      alert(`Load set to ${load} for ${name}`);
      loadAdminData();
      loadReviewers();
    } catch (err) { alert(err.message); }
  });
}

async function loadAdminData() {
  try {
    const reviewers = await API.getReviewers();
    const settings = await API.getSettings();

    const roleSelect = document.getElementById('role-user-select');
    const loadSelect = document.getElementById('load-user-select');
    const pwSelect = document.getElementById('pw-user-select');
    [roleSelect, loadSelect, pwSelect].forEach(sel => sel.innerHTML = '');

    reviewers.filter(r => r.role !== 'admin').sort((a, b) => a.name.localeCompare(b.name)).forEach(r => {
      [roleSelect, loadSelect, pwSelect].forEach(s => {
        const opt = document.createElement('option');
        opt.value = r.name;
        opt.textContent = `${r.name} (${r.role})`;
        s.appendChild(opt);
      });
    });

    loadSelect.addEventListener('change', () => {
      const selected = reviewers.find(r => r.name === loadSelect.value);
      if (selected) document.getElementById('load-input').value = selected.load;
    });
    loadSelect.dispatchEvent(new Event('change'));

    loadPasswords();
  } catch (err) {
    console.error('Failed to load admin data:', err);
  }
}

async function adminSetPassword() {
  const name = document.getElementById('pw-user-select').value;
  const password = document.getElementById('pw-set-input').value.trim();
  const resultEl = document.getElementById('pw-result');
  if (!name || !password) { resultEl.textContent = 'Select a user and enter a password'; resultEl.className = 'error-msg'; resultEl.style.display = 'block'; return; }
  try {
    await API.setUserPassword(name, password);
    resultEl.textContent = `Password set for ${name}`;
    resultEl.className = 'success-msg';
    resultEl.style.display = 'block';
    document.getElementById('pw-set-input').value = '';
    loadAdminData();
  } catch (err) { resultEl.textContent = err.message; resultEl.className = 'error-msg'; resultEl.style.display = 'block'; }
}

async function adminResetPassword() {
  const name = document.getElementById('pw-user-select').value;
  const resultEl = document.getElementById('pw-result');
  if (!name) { resultEl.textContent = 'Select a user first'; resultEl.className = 'error-msg'; resultEl.style.display = 'block'; return; }
  try {
    const data = await API.resetPassword(name, currentUser.role);
    resultEl.innerHTML = `New password for <strong>${name}</strong>: <code style="font-size: 1.1rem; background: var(--bg-input); padding: 0.25rem 0.5rem; border-radius: 4px;">${data.password}</code>`;
    resultEl.className = 'success-msg';
    resultEl.style.display = 'block';
    loadAdminData();
  } catch (err) { resultEl.textContent = err.message; resultEl.className = 'error-msg'; resultEl.style.display = 'block'; }
}

async function loadPasswords() {
  try {
    const passwords = await API.getAdminPasswords(currentUser.role);
    const tbody = document.getElementById('admin-passwords-body');
    tbody.innerHTML = '';
    passwords.sort((a, b) => a.name.localeCompare(b.name)).forEach(r => {
      const tr = document.createElement('tr');
      const discordCell = r.discordId
        ? `<span style="color: var(--success); font-size: 0.75rem;">✅ Linked</span> <button class="btn btn-sm btn-warning" onclick="unlinkDiscord('${r.name}')">Unlink</button>`
        : `<span style="color: var(--text-muted); font-size: 0.75rem;">Not linked</span> <button class="btn btn-sm btn-primary" onclick="promptLinkDiscord('${r.name}')">Link</button>`;
      tr.innerHTML = `<td><strong>${r.name}</strong></td><td><span class="role-badge ${r.role}">${r.role.replace('_', ' ')}</span></td><td><code>${r.plainPassword || 'Not set'}</code></td><td>${discordCell}</td><td><button class="btn btn-sm btn-warning" onclick="adminResetPasswordByName('${r.name}')">Reset</button></td>`;
      tbody.appendChild(tr);
    });
  } catch (err) { console.error('Failed to load passwords:', err); }
}

async function adminResetPasswordByName(name) {
  const resultEl = document.getElementById('pw-result');
  try {
    const data = await API.resetPassword(name, currentUser.role);
    resultEl.innerHTML = `New password for <strong>${name}</strong>: <code style="font-size: 1.1rem; background: var(--bg-input); padding: 0.25rem 0.5rem; border-radius: 4px;">${data.password}</code>`;
    resultEl.className = 'success-msg';
    resultEl.style.display = 'block';
    loadAdminData();
  } catch (err) { resultEl.textContent = err.message; resultEl.className = 'error-msg'; resultEl.style.display = 'block'; }
}

async function unlinkDiscord(name) {
  if (!confirm(`Remove Discord link for ${name}? They will need to use /link again.`)) return;
  try {
    await API.unlinkDiscord(name);
    alert(`Discord link removed for ${name}`);
    loadAdminData();
  } catch (err) { alert(err.message); }
}

async function promptLinkDiscord(name) {
  const discordId = prompt(`Enter Discord User ID for ${name}:\n(Right-click user in Discord → Copy ID)`, '');
  if (!discordId) return;
  try {
    await API.linkDiscord(name, discordId.trim());
    alert(`Discord linked to ${name}`);
    loadAdminData();
  } catch (err) { alert(err.message); }
}

function formatStatus(status) {
  const map = { in_review: 'In Review', fix_needed: 'Fix Needed', fix_made: 'Fix Made', escalated: 'Escalated', approved: 'Approved', rejected: 'Rejected', deleted: 'Deleted', pending: 'Pending' };
  return map[status] || status;
}

async function loadAllReviews() {
  try {
    const { active, history } = await API.getReviews();
    const all = [...active, ...history].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const tbody = document.getElementById('all-reviews-body');
    const empty = document.getElementById('no-all-reviews');
    const countEl = document.getElementById('all-reviews-count');
    tbody.innerHTML = '';
    if (all.length === 0) { empty.style.display = 'block'; countEl.textContent = ''; return; }
    empty.style.display = 'none';
    countEl.textContent = `(${all.length} total)`;
    const canEdit = currentUser.role === 'admin' || currentUser.role === 'manager';
    all.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code>${r.id}</code></td>
        <td><code>${r.branch}</code></td>
        <td>${r.merger}</td>
        <td>${r.reviewers.map(rv => rv.name).join(', ')}</td>
        <td>${r.approvalCount}/${r.reviewers.length}</td>
        <td><span class="priority-badge ${r.priority}">${r.priority}</span></td>
        <td style="font-size:0.75rem;color:var(--text-muted)">${r.size || '—'}</td>
        <td>${canEdit ? `<select onchange="updateReviewStatus('${r.id}', this.value)" style="background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);padding:0.25rem;font-size:0.75rem;">${['pending','in_review','fix_needed','fix_made','escalated','approved','rejected','deleted'].map(s => `<option value="${s}" ${r.status === s ? 'selected' : ''}>${formatStatus(s)}</option>`).join('')}</select>` : `<span class="status-badge ${r.status}">${formatStatus(r.status)}</span>`}
        </td>
        <td style="font-size:0.75rem;color:var(--text-muted)">${new Date(r.createdAt).toLocaleDateString()}</td>
        <td>
          <button class="btn btn-sm btn-secondary" onclick="openReviewModal('${r.id}')">Details</button>
          ${canEdit && r.status !== 'deleted' ? `<button class="btn btn-sm btn-danger" onclick="deleteReview('${r.id}')">Delete</button>` : ''}
        </td>`;
      tbody.appendChild(tr);
    });
  } catch (err) { console.error('Failed to load all reviews:', err); }
}

async function updateReviewStatus(id, newStatus) {
  try {
    await API.updateReviewStatus(id, newStatus);
    loadAllReviews();
    loadReviews();
  } catch (err) { alert(err.message); }
}

async function loadRawData() {
  try {
    const [reviewsRes, reviewers, settings] = await Promise.all([API.getReviews(), API.getReviewers(), API.getSettings()]);
    const data = { reviews: [...reviewsRes.active, ...reviewsRes.history], reviewers, settings };
    document.getElementById('raw-data-view').textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    document.getElementById('raw-data-view').textContent = 'Error loading data: ' + err.message;
  }
}

function copyRawData() {
  const text = document.getElementById('raw-data-view').textContent;
  navigator.clipboard.writeText(text).then(() => alert('Raw data copied'), () => alert('Failed to copy — select and copy manually'));
}

let editingReviewerName = null;

function loadNextGroupName() {
  const el = document.getElementById('next-group-name');
  if (!el) return;
  fetch('/api/sheets/next-group-name')
    .then(r => r.json())
    .then(d => { el.textContent = d.tabName; })
    .catch(() => { el.textContent = 'unavailable'; });
}

async function syncDiscordApprovals() {
  const btn = document.querySelector('#admin-sync .btn-primary');
  const resultEl = document.getElementById('sync-result');
  btn.disabled = true;
  btn.textContent = 'Syncing...';
  resultEl.innerHTML = '';
  try {
    const res = await fetch('/api/sheets/sync-discord', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userRole: currentUser.role })
    });
    const data = await res.json();
    if (res.ok) {
      resultEl.innerHTML = `<div class="success-msg">✅ Discord approvals synced!</div>`;
    } else {
      resultEl.innerHTML = `<div class="error-msg">${data.error || 'Sync failed'}</div>`;
    }
  } catch (err) {
    resultEl.innerHTML = `<div class="error-msg">Error: ${err.message}</div>`;
  }
  btn.disabled = false;
  btn.textContent = 'Sync Now';
}

async function createNewGroup() {
  const btn = document.querySelector('#admin-season-groups .btn-primary');
  const resultEl = document.getElementById('group-result');
  btn.disabled = true;
  btn.textContent = 'Creating...';
  resultEl.innerHTML = '';
  try {
    const res = await fetch('/api/sheets/new-group', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userRole: currentUser.role })
    });
    const data = await res.json();
    if (data.created) {
      resultEl.innerHTML = `<div class="success-msg">✅ Tab "<strong>${data.tabName}</strong>" created!</div>`;
      loadNextGroupName();
    } else if (data.reason === 'already exists') {
      resultEl.innerHTML = `<div class="error-msg">Tab "<strong>${data.tabName}</strong>" already exists.</div>`;
    } else {
      resultEl.innerHTML = `<div class="error-msg">Failed: ${data.reason || data.error || 'Unknown error'}</div>`;
    }
  } catch (err) {
    resultEl.innerHTML = `<div class="error-msg">Error: ${err.message}</div>`;
  }
  btn.disabled = false;
  btn.textContent = 'Create New Group';
}

async function openReviewerEdit(name) {
  const reviewers = await API.getReviewers();
  const reviewer = reviewers.find(r => r.name === name);
  if (!reviewer) return;
  editingReviewerName = name;
  document.getElementById('reviewer-modal-title').textContent = `Edit: ${name}`;
  document.getElementById('reviewer-edit-name').value = reviewer.name;
  document.getElementById('reviewer-edit-role').value = reviewer.role;
  document.getElementById('reviewer-edit-speciality').value = reviewer.speciality || 'None';
  document.getElementById('reviewer-edit-load').value = reviewer.load || 0;
  document.getElementById('reviewer-edit-maxload').value = reviewer.maxLoad || 3;
  document.getElementById('reviewer-edit-weekly').value = reviewer.weeklyCount || 0;
  document.getElementById('reviewer-edit-maxweekly').value = reviewer.maxActiveReviews || 5;
  document.getElementById('reviewer-modal-result').style.display = 'none';
  document.getElementById('reviewer-modal').style.display = 'flex';
}

function closeReviewerModal() {
  document.getElementById('reviewer-modal').style.display = 'none';
  editingReviewerName = null;
}

async function saveReviewerEdit() {
  const resultEl = document.getElementById('reviewer-modal-result');
  const name = document.getElementById('reviewer-edit-name').value.trim();
  if (!name) { resultEl.textContent = 'Name is required'; resultEl.className = 'error-msg'; resultEl.style.display = 'block'; return; }
  try {
    await API.updateReviewer(editingReviewerName, {
      name,
      role: document.getElementById('reviewer-edit-role').value,
      speciality: document.getElementById('reviewer-edit-speciality').value,
      load: parseInt(document.getElementById('reviewer-edit-load').value) || 0,
      maxLoad: parseInt(document.getElementById('reviewer-edit-maxload').value) || 3,
      weeklyCount: parseInt(document.getElementById('reviewer-edit-weekly').value) || 0,
      maxActiveReviews: parseInt(document.getElementById('reviewer-edit-maxweekly').value) || 5
    });
    resultEl.textContent = `Saved changes to ${editingReviewerName}`;
    resultEl.className = 'success-msg';
    resultEl.style.display = 'block';
    loadReviewers();
    loadAdminData();
    setTimeout(closeReviewerModal, 1500);
  } catch (err) { resultEl.textContent = err.message; resultEl.className = 'error-msg'; resultEl.style.display = 'block'; }
}
