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
    debugLoadTables();
  }

  if (currentUser.role === 'admin') {
    document.getElementById('merger-group').style.display = 'flex';
    loadMergerOptions();
  }

  setupTabs();
  setupNewReviewForm();
  setupAdminForms();
  setupAddUserForm();
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
      if (btn.dataset.tab === 'debug') debugTabActivated();
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
      const isReviewable = r.role === 'reviewer' || r.role === 'senior' || r.role === 'admin';
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
    if (isSenior && (review.status === 'in_review' || review.status === 'fix_made')) {
      actionsHTML += `<button class="btn btn-sm btn-primary" onclick="seniorApprove('${id}')">★ Senior Approve</button>`;
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
      ${review.deadlineAt ? `<div class="review-detail-row"><span class="review-detail-label">Deadline</span><span class="review-detail-value" style="${new Date(review.deadlineAt) < new Date() ? 'color:#dc3545;font-weight:bold;' : ''}">${new Date(review.deadlineAt).toLocaleString()}${new Date(review.deadlineAt) < new Date() ? ' (OVERDUE)' : ''}</span></div>` : ''}
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

async function seniorApprove(id) {
  if (!confirm('Senior approve this review? This will fully approve it immediately, bypassing other reviewers.')) return;
  try {
    await API.seniorApproveReview(id, currentUser.name);
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

function setupAddUserForm() {
  if (currentUser.role !== 'admin') return;
  document.getElementById('add-user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const resultEl = document.getElementById('adduser-result');
    const name = document.getElementById('adduser-name').value.trim();
    const speciality = document.getElementById('adduser-speciality').value;
    const role = document.getElementById('adduser-role').value;
    const discordId = document.getElementById('adduser-discordid').value.trim();

    if (!name) { resultEl.innerHTML = '<span class="error-msg">Name is required</span>'; return; }

    try {
      const reviewers = await API.addReviewer(name, speciality, role, discordId);
      resultEl.innerHTML = `<span class="success-msg">✅ User <strong>${escHtml(name)}</strong> added!</span>`;
      document.getElementById('add-user-form').reset();
      loadReviewers();
      if (typeof loadAdminData === 'function') loadAdminData();
    } catch (err) {
      resultEl.innerHTML = `<span class="error-msg">${escHtml(err.message)}</span>`;
    }
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
    loadGitLabSettings();
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
      const status = r.hasPassword ? '✅ Set' : '❌ Not set';
      tr.innerHTML = `<td><strong>${r.name}</strong></td><td><span class="role-badge ${r.role}">${r.role.replace('_', ' ')}</span></td><td>${status}</td><td><button class="btn btn-sm btn-warning" onclick="adminResetPasswordByName('${r.name}')">Reset</button></td>`;
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
          ${canEdit && r.status !== 'deleted' ? `<button class="btn btn-sm btn-primary" onclick="openEditReviewModal('${r.id}')">Edit</button><button class="btn btn-sm btn-danger" onclick="deleteReview('${r.id}')">Delete</button>` : ''}
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

async function openEditReviewModal(id) {
  const modal = document.getElementById('edit-review-modal');
  const body = document.getElementById('edit-review-body');
  modal.style.display = 'flex';
  body.innerHTML = '<p style="color:var(--text-muted)">Loading...</p>';

  try {
    const review = await API.getReview(id);
    body.innerHTML = `
      <div class="form-group"><label>Branch</label>
        <input id="edit-branch" value="${escHtml(review.branch)}" style="width:100%;padding:0.5rem;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);"></div>
      <div class="form-group" style="margin-top:0.5rem;"><label>Merger</label>
        <input id="edit-merger" value="${escHtml(review.merger)}" style="width:100%;padding:0.5rem;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);"></div>
      <div class="form-row" style="margin-top:0.5rem;">
        <div class="form-group"><label>Type</label>
          <select id="edit-type" style="width:100%;padding:0.5rem;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);">
            ${['frontend','backend','fullstack'].map(t => `<option value="${t}" ${review.reviewType === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select></div>
        <div class="form-group"><label>Priority</label>
          <select id="edit-priority" style="width:100%;padding:0.5rem;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);">
            ${['low','mid','imp'].map(p => `<option value="${p}" ${review.priority === p ? 'selected' : ''}>${p}</option>`).join('')}
          </select></div>
      </div>
      <div class="form-row" style="margin-top:0.5rem;">
        <div class="form-group"><label>Status</label>
          <select id="edit-status" style="width:100%;padding:0.5rem;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);">
            ${['pending','in_review','fix_needed','fix_made','escalated','approved','rejected','deleted'].map(s => `<option value="${s}" ${review.status === s ? 'selected' : ''}>${formatStatus(s)}</option>`).join('')}
          </select></div>
        <div class="form-group"><label>Approvals</label>
          <input id="edit-approvals" type="number" min="0" max="${review.reviewers.length}" value="${review.approvalCount}" style="width:100%;padding:0.5rem;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);"></div>
      </div>
      <div class="form-group" style="margin-top:0.5rem;"><label>Commit Ref</label>
        <input id="edit-commit" value="${escHtml(review.commitRef || '')}" style="width:100%;padding:0.5rem;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);"></div>
      <h4 style="margin-top:1rem;margin-bottom:0.5rem;">Reviewers</h4>
      <div class="table-wrapper">
        <table style="font-size:0.75rem;"><thead><tr><th>Name</th><th>Status</th><th>Comment</th></tr></thead>
          <tbody>${review.reviewers.map((rv, i) => `
            <tr>
              <td><strong>${escHtml(rv.name)}</strong></td>
              <td><select id="edit-rv-status-${i}" style="padding:0.25rem;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);">
                ${['pending','approved','disapproved'].map(s => `<option value="${s}" ${rv.status === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select></td>
              <td><input id="edit-rv-comment-${i}" value="${escHtml(rv.comment || '')}" style="width:100%;padding:0.25rem;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);"></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div style="margin-top:1rem;display:flex;gap:0.5rem;">
        <button class="btn btn-primary" onclick="saveEditReview('${id}')">Save Changes</button>
        <button class="btn btn-ghost" onclick="document.getElementById('edit-review-modal').style.display='none'">Cancel</button>
      </div>
      <div id="edit-review-result" class="success-msg" style="display:none;margin-top:0.75rem;"></div>`;
  } catch (err) {
    body.innerHTML = `<p style="color:var(--danger)">Error: ${err.message}</p>`;
  }
}

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

async function saveEditReview(id) {
  const resultEl = document.getElementById('edit-review-result');
  const updates = {
    branch: document.getElementById('edit-branch').value,
    merger: document.getElementById('edit-merger').value,
    reviewType: document.getElementById('edit-type').value,
    priority: document.getElementById('edit-priority').value,
    status: document.getElementById('edit-status').value,
    commitRef: document.getElementById('edit-commit').value,
    approvalCount: parseInt(document.getElementById('edit-approvals').value) || 0,
    reviewers: []
  };

  const review = await API.getReview(id);
  review.reviewers.forEach((rv, i) => {
    updates.reviewers.push({
      name: rv.name,
      status: document.getElementById(`edit-rv-status-${i}`).value,
      comment: document.getElementById(`edit-rv-comment-${i}`).value
    });
  });

  try {
    await API.editReview(id, updates);
    resultEl.textContent = 'Review updated successfully!';
    resultEl.className = 'success-msg';
    resultEl.style.display = 'block';
    setTimeout(() => {
      document.getElementById('edit-review-modal').style.display = 'none';
      loadAllReviews();
      loadReviews();
    }, 800);
  } catch (err) {
    resultEl.textContent = err.message;
    resultEl.className = 'error-msg';
    resultEl.style.display = 'block';
  }
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

async function loadGitLabSettings() {
  try {
    const res = await fetch('/api/settings/gitlab');
    const data = await res.json();
    document.getElementById('gitlab-url').value = data.gitlabUrl || '';
    document.getElementById('gitlab-token').value = data.gitlabToken || '';
    document.getElementById('gitlab-project').value = data.gitlabProject || '';
  } catch (err) {
    console.error('Failed to load GitLab settings:', err);
  }
}

async function saveGitLabSettings() {
  const resultEl = document.getElementById('gitlab-result');
  try {
    const res = await fetch('/api/settings/gitlab', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gitlabUrl: document.getElementById('gitlab-url').value.trim(),
        gitlabToken: document.getElementById('gitlab-token').value.trim(),
        gitlabProject: document.getElementById('gitlab-project').value.trim()
      })
    });
    const data = await res.json();
    if (res.ok) {
      resultEl.innerHTML = '<span class="status-badge approved">GitLab settings saved</span>';
    } else {
      resultEl.innerHTML = `<span class="status-badge rejected">${data.error || 'Save failed'}</span>`;
    }
  } catch (err) {
    resultEl.innerHTML = `<span class="status-badge rejected">Error: ${err.message}</span>`;
  }
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
  document.getElementById('reviewer-edit-maxload').value = reviewer.maxLoad || 0;
  document.getElementById('reviewer-edit-weekly').value = reviewer.weeklyCount || 0;
  document.getElementById('reviewer-edit-maxweekly').value = reviewer.maxActiveReviews || 0;
  document.getElementById('reviewer-edit-disabled').checked = !!reviewer.disabled;
  document.getElementById('reviewer-modal-result').style.display = 'none';
  document.getElementById('reviewer-modal').style.display = 'flex';
}

function closeReviewerModal() {
  document.getElementById('reviewer-modal').style.display = 'none';
  editingReviewerName = null;
}

// ===== DEBUG TAB =====

function debugTabActivated() {
  debugLoadLogs();
}

async function debugLoadLogs() {
  const lines = parseInt(document.getElementById('debug-log-lines').value) || 100;
  const view = document.getElementById('debug-log-view');
  view.textContent = 'Loading...';
  try {
    const data = await API.debugGetLogs(lines);
    view.textContent = data.entries.join('\n') || '(empty log)';
  } catch (err) {
    view.textContent = `Error: ${err.message}`;
  }
}

function debugClearLogs() {
  document.getElementById('debug-log-view').textContent = '';
}

async function debugLoadTables() {
  const select = document.getElementById('debug-table-select');
  if (!select) return;
  try {
    const tables = await API.debugGetTables();
    select.innerHTML = '<option value="">— Select —</option>';
    tables.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.name;
      opt.textContent = `${t.name} (${t.rowCount} rows)`;
      opt.dataset.columns = JSON.stringify(t.columns);
      select.appendChild(opt);
    });
  } catch (err) {
    console.error('Failed to load tables:', err);
  }
}

async function debugLoadTable() {
  const select = document.getElementById('debug-table-select');
  const name = select.value;
  const head = document.getElementById('debug-table-head');
  const body = document.getElementById('debug-table-body');
  const empty = document.getElementById('debug-table-empty');
  const info = document.getElementById('debug-table-info');

  head.innerHTML = '';
  body.innerHTML = '';
  if (!name) { empty.style.display = 'block'; info.textContent = ''; return; }
  empty.style.display = 'none';
  info.textContent = 'Loading...';

  try {
    const data = await API.debugGetTable(name);
    info.textContent = `${data.rows.length} rows`;

    const selectedOpt = select.options[select.selectedIndex];
    const columns = selectedOpt ? JSON.parse(selectedOpt.dataset.columns) : [];
    const pkCols = columns.filter(c => c.pk).map(c => c.name);
    const idCol = pkCols[0] || 'rowid';

    // Header
    const tr = document.createElement('tr');
    tr.innerHTML = `<th></th>` + data.columns.map(c => `<th>${c}</th>`).join('') + `<th style="width:60px;"></th>`;
    head.appendChild(tr);

    // Rows
    data.rows.forEach((row, idx) => {
      const rowEl = document.createElement('tr');
      const rowNum = idx + 1;
      const rowId = row[idCol];
      let cells = `<td style="color:var(--text-muted);font-size:0.65rem;">${rowNum}</td>`;
      let editing = false;
      data.columns.forEach(col => {
        const val = row[col] !== null && row[col] !== undefined ? String(row[col]) : '';
        cells += `<td class="debug-cell" data-table="${name}" data-col="${col}" data-idcol="${idCol}" data-id="${rowId}" data-original="${val.replace(/"/g, '&quot;')}"><span class="debug-val">${escapeHtml(val)}</span></td>`;
      });
      cells += `<td><button class="btn btn-sm btn-ghost" style="font-size:0.65rem;padding:0.15rem 0.4rem;" onclick="debugEditRow(this)">✎</button></td>`;
      rowEl.innerHTML = cells;
      body.appendChild(rowEl);
    });
  } catch (err) {
    info.textContent = `Error: ${err.message}`;
  }
}

function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function debugEditRow(btn) {
  const row = btn.closest('tr');
  const cells = row.querySelectorAll('.debug-cell');
  const isEditing = row.classList.contains('editing');

  if (isEditing) {
    // Save
    const updates = {};
    cells.forEach(cell => {
      const input = cell.querySelector('input');
      if (input) {
        const newVal = input.value;
        const oldVal = cell.dataset.original;
        if (newVal !== oldVal) {
          updates[cell.dataset.col] = newVal;
        }
        cell.innerHTML = `<span class="debug-val">${escapeHtml(newVal)}</span>`;
        cell.dataset.original = newVal;
      }
    });
    row.classList.remove('editing');
    btn.textContent = '✎';

    if (Object.keys(updates).length > 0) {
      const table = cells[0].dataset.table;
      const idCol = cells[0].dataset.idcol;
      const idVal = cells[0].dataset.id;
      debugSaveRow(table, idCol, idVal, updates);
    }
  } else {
    // Edit mode
    cells.forEach(cell => {
      const val = cell.dataset.original;
      cell.innerHTML = `<input type="text" value="${escapeHtml(val)}" style="width:100%;background:var(--bg-input);border:1px solid var(--accent);border-radius:3px;padding:0.15rem 0.3rem;color:var(--text);font-size:0.7rem;">`;
    });
    row.classList.add('editing');
    btn.textContent = '💾';
  }
}

async function debugSaveRow(table, idCol, idVal, updates) {
  try {
    const result = await API.debugUpdateRow(table, idCol, idVal, updates);
    const info = document.getElementById('debug-table-info');
    if (result.success) {
      info.textContent = `✅ Updated ${result.updatedFields} field(s) in ${table}`;
    }
  } catch (err) {
    alert(`Failed to save: ${err.message}`);
  }
}

async function debugRunQuery() {
  const input = document.getElementById('debug-sql-input');
  const result = document.getElementById('debug-sql-result');
  const sql = input.value.trim();
  if (!sql) { result.textContent = 'Enter a SQL query'; return; }

  result.textContent = 'Running...';
  try {
    const data = await API.debugRunQuery(sql);
    if (data.count === 0) {
      result.textContent = '(no results)';
      return;
    }
    // Render as simple table
    let out = `(${data.count} rows)\n\n`;
    out += data.columns.join('\t') + '\n';
    out += data.columns.map(() => '---').join('\t') + '\n';
    data.rows.forEach(row => {
      out += data.columns.map(c => row[c] !== null && row[c] !== undefined ? String(row[c]) : '').join('\t') + '\n';
    });
    result.textContent = out;
  } catch (err) {
    result.textContent = `Error: ${err.message}`;
  }
}

async function debugInspectSheets() {
  const tab = document.getElementById('debug-sheets-tab').value;
  const result = document.getElementById('debug-sheets-result');
  result.textContent = 'Inspecting...';

  try {
    const data = await API.debugGetSheetColumns(tab);
    if (!data.available) {
      result.innerHTML = `<span style="color:var(--text-muted);">${data.reason || 'Sheets not configured'}</span>`;
      return;
    }
    if (data.error) {
      result.innerHTML = `<span style="color:var(--danger);">Error: ${data.error}</span>`;
      return;
    }
    let html = `<div style="font-size:0.75rem;">Tab: <strong>${data.tabName}</strong> — ${data.columns.length} columns</div><div style="display:grid;grid-template-columns:auto auto 1fr;gap:0.25rem 1rem;margin-top:0.5rem;font-size:0.7rem;">`;
    data.columns.forEach(c => {
      html += `<span style="color:var(--text-muted);">${c.column}</span>`;
      html += `<span style="color:var(--text-muted);">#${c.index + 1}</span>`;
      html += `<span>${c.header}</span>`;
    });
    html += '</div>';
    result.innerHTML = html;
  } catch (err) {
    result.innerHTML = `<span style="color:var(--danger);">Error: ${err.message}</span>`;
  }
}

async function debugGitStatus() {
  const result = document.getElementById('debug-git-result');
  result.textContent = 'Checking...';
  try {
    const data = await API.debugGetGitStatus();
    if (data.error) {
      result.textContent = `Error: ${data.error}`;
      return;
    }
    let out = `Branch: ${data.branch}\n`;
    out += `Ahead: ${data.ahead} | Behind: ${data.behind}\n`;
    if (data.dirty && data.dirty.length > 0) {
      out += `\nUncommitted changes:\n  ${data.dirty.join('\n  ')}\n`;
    } else {
      out += '\nWorking tree: clean\n';
    }
    out += '\nRecent commits:\n';
    data.commits.forEach(c => {
      out += `  ${c.hash} ${c.message} (${new Date(c.date).toLocaleDateString()})\n`;
    });
    result.textContent = out;
  } catch (err) {
    result.textContent = `Error: ${err.message}`;
  }
}

async function debugTriggerSync() {
  const result = document.getElementById('debug-action-result');
  result.innerHTML = '<span class="status-badge pending">Syncing...</span>';
  try {
    const res = await fetch('/api/sheets/sync-discord', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userRole: currentUser.role })
    });
    const data = await res.json();
    if (res.ok) {
      result.innerHTML = '<span class="status-badge approved">✅ Discord sync triggered</span>';
    } else {
      result.innerHTML = `<span class="status-badge rejected">${data.error || 'Sync failed'}</span>`;
    }
  } catch (err) {
    result.innerHTML = `<span class="status-badge rejected">Error: ${err.message}</span>`;
  }
}

async function debugBulkSyncSheets() {
  const result = document.getElementById('debug-action-result');
  result.innerHTML = '<span class="status-badge pending">Syncing...</span>';
  try {
    const res = await fetch('/api/sheets/bulk-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userRole: currentUser.role })
    });
    const data = await res.json();
    if (res.ok) {
      result.innerHTML = '<span class="status-badge approved">✅ Review Queue synced</span>';
    } else {
      result.innerHTML = `<span class="status-badge rejected">${data.error || 'Sync failed'}</span>`;
    }
  } catch (err) {
    result.innerHTML = `<span class="status-badge rejected">Error: ${err.message}</span>`;
  }
}

async function saveReviewerEdit() {
  const resultEl = document.getElementById('reviewer-modal-result');
  const name = document.getElementById('reviewer-edit-name').value.trim();
  if (!name) { resultEl.textContent = 'Name is required'; resultEl.className = 'error-msg'; resultEl.style.display = 'block'; return; }
  try {
    await API.updateReviewer(editingReviewerName, {
      role: document.getElementById('reviewer-edit-role').value,
      speciality: document.getElementById('reviewer-edit-speciality').value,
      load: parseInt(document.getElementById('reviewer-edit-load').value) || 0,
      maxLoad: parseInt(document.getElementById('reviewer-edit-maxload').value) || 0,
      weeklyCount: parseInt(document.getElementById('reviewer-edit-weekly').value) || 0,
      maxActiveReviews: parseInt(document.getElementById('reviewer-edit-maxweekly').value) || 0,
      disabled: document.getElementById('reviewer-edit-disabled').checked
    });
    resultEl.textContent = `Saved changes to ${editingReviewerName}`;
    resultEl.className = 'success-msg';
    resultEl.style.display = 'block';
    loadReviewers();
    loadAdminData();
    setTimeout(closeReviewerModal, 1500);
  } catch (err) { resultEl.textContent = err.message; resultEl.className = 'error-msg'; resultEl.style.display = 'block'; }
}

async function deleteReviewerFromModal() {
  const name = editingReviewerName;
  if (!name) return;
  if (!confirm(`Are you sure you want to delete "${name}"? This cannot be undone.`)) return;
  const resultEl = document.getElementById('reviewer-modal-result');
  try {
    await API.removeReviewer(name);
    resultEl.textContent = `Deleted ${name}`;
    resultEl.className = 'success-msg';
    resultEl.style.display = 'block';
    loadReviewers();
    loadAdminData();
    setTimeout(closeReviewerModal, 1500);
  } catch (err) { resultEl.textContent = err.message; resultEl.className = 'error-msg'; resultEl.style.display = 'block'; }
}
