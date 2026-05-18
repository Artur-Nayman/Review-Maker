const userSelect = document.getElementById('user-select');
const passwordGroup = document.getElementById('password-group');
const adminPassword = document.getElementById('admin-password');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');

async function loadUsers() {
  try {
    const res = await fetch('/api/reviewers');
    const reviewers = await res.json();

    reviewers.sort((a, b) => a.name.localeCompare(b.name));

    reviewers.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.name;
      opt.textContent = `${r.name} (${r.speciality})`;
      userSelect.appendChild(opt);
    });
  } catch (err) {
    loginError.textContent = 'Failed to load users. Is the server running?';
    loginError.style.display = 'block';
  }
}

userSelect.addEventListener('change', () => {
  const selected = userSelect.value;
  const opt = userSelect.querySelector(`option[value="${selected}"]`);
  const isSenior = opt && opt.textContent.includes('Senior');

  if (selected.toLowerCase().includes('artur nayman')) {
    passwordGroup.style.display = 'block';
    adminPassword.required = true;
  } else {
    passwordGroup.style.display = 'none';
    adminPassword.required = false;
  }
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.style.display = 'none';

  const name = userSelect.value;
  const password = adminPassword.value;

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password })
    });

    const data = await res.json();

    if (!res.ok) {
      loginError.textContent = data.error;
      loginError.style.display = 'block';
      return;
    }

    localStorage.setItem('reviewMakerUser', JSON.stringify(data));
    window.location.href = '/dashboard.html';
  } catch (err) {
    loginError.textContent = 'Connection error. Is the server running?';
    loginError.style.display = 'block';
  }
});

loadUsers();
