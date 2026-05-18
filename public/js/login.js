const userSelect = document.getElementById('user-select');
const passwordGroup = document.getElementById('password-group');
const loginPassword = document.getElementById('login-password');
const passwordHint = document.getElementById('password-hint');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');

let usersWithPasswords = new Set();

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

      if (r.hasPassword) {
        usersWithPasswords.add(r.name);
      }
    });
  } catch (err) {
    loginError.textContent = 'Failed to load users. Is the server running?';
    loginError.style.display = 'block';
  }
}

userSelect.addEventListener('change', () => {
  const selected = userSelect.value;

  if (usersWithPasswords.has(selected)) {
    passwordHint.style.display = 'block';
    loginPassword.required = true;
    loginPassword.placeholder = 'Enter your password';
  } else {
    passwordHint.style.display = 'none';
    loginPassword.required = false;
    loginPassword.placeholder = 'Optional (set after first login)';
  }
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.style.display = 'none';

  const name = userSelect.value;
  const password = loginPassword.value;

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

    if (!data.hasPassword && data.role !== 'admin') {
      window.location.href = '/set-password.html?token=first-login&name=' + encodeURIComponent(data.name);
      return;
    }

    window.location.href = '/dashboard.html';
  } catch (err) {
    loginError.textContent = 'Connection error. Is the server running?';
    loginError.style.display = 'block';
  }
});

loadUsers();
