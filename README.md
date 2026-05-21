# Review Maker

Review assignment system with load balancing, role-based access, and Discord bot integration.

## Features

- **Web Dashboard** — Create reviews, manage reviewers, track approvals
- **Discord Bot** — Full review management via slash commands
- **Git-synced Data** — `data.json` is tracked in Git, auto-commits on every change
- **Standalone Remote Dashboard** — Browser-only dashboard that talks directly to GitHub
- **Password Management** — Pre-generated passwords, admin-only visibility
- **Load Balancing** — Automatic reviewer assignment with specialty matching

## Quick Start (Local PC)

### Prerequisites
- Node.js v18+
- Git
- A GitHub repository with this code pushed

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env` and fill in:
```env
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_client_id_here
DISCORD_GUILD_ID=your_server_id_here
```

**Getting Discord credentials:**
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to **Bot** → **Reset Token** → copy the token
4. Go to **OAuth2** → copy **Client ID**
5. Enable **Server Members Intent** and **Message Content Intent** under Bot → Privileged Gateway Intents
6. Get your **Guild ID** from Discord: User Settings → Advanced → Developer Mode ON → right-click your server → Copy ID

### 3. Invite Bot to Server
Open this URL in your browser (replace `YOUR_CLIENT_ID`):
```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=8&scope=bot%20applications.commands
```
Select your server and authorize.

### 4. Deploy Slash Commands
```bash
npm run bot:deploy
```
If you set `DISCORD_GUILD_ID` in `.env`, commands appear instantly. Otherwise, global commands take up to 1 hour to propagate.

### 5. Start Services
```bash
# Web dashboard only
npm start

# Discord bot only
npm run bot

# Both simultaneously
npm run all
```

Web dashboard: http://localhost:3000
Default admin: `Admin` / `root`

---

## Installation on Termux (Android)

### 1. Install Termux
Install from [F-Droid](https://f-droid.org/packages/com.termux/) (recommended) or GitHub releases. Do NOT use the Play Store version (outdated).

### 2. Update Packages
```bash
pkg update && pkg upgrade
```

### 3. Install Node.js and Git
```bash
pkg install nodejs git
```

### 4. Clone Repository
```bash
git clone https://github.com/YOUR_USERNAME/Review-Maker.git
cd Review-Maker
```

### 5. Install Dependencies
```bash
npm install
```

### 6. Configure Environment
```bash
cp .env.example .env
nano .env
```
Fill in your Discord credentials (see step 2 above for how to get them).

### 7. Deploy Commands (first time only)
```bash
npm run bot:deploy
```

### 8. Run
```bash
# Both server and bot
npm run all

# Or run separately
npm start    # web dashboard
npm run bot  # discord bot
```

Access the web dashboard at `http://localhost:3000` in your phone's browser.

### Termux Tips
- Keep Termux running in the background for the bot to stay online
- Use `termux-wake-lock` to prevent Android from killing the process
- To run in background: `npm run all &` (then close Termux — but note Android may still kill it)
- For persistent background running, consider using `tmux` or `screen`:
  ```bash
  pkg install tmux
  tmux new -s review-maker
  npm run all
  # Press Ctrl+B, then D to detach
  ```

---

## Standalone Remote Dashboard

For accessing the dashboard from anywhere without running a server:

1. Open `dashboard-remote.html` in any browser
2. Enter your:
   - **GitHub Personal Access Token** (needs `repo` scope)
   - **Repository** (format: `owner/repo`)
   - **Branch** (e.g., `discord-bot`)
3. Click **Connect**

The dashboard reads/writes `data.json` directly via the GitHub API. Changes are auto-committed and synced with the server/bot.

**Creating a GitHub PAT:**
1. Go to GitHub → Settings → Developer Settings → Personal Access Tokens → Tokens (classic)
2. Generate new token (classic)
3. Select `repo` scope
4. Copy the token — you won't see it again

---

## Architecture

```
[GitHub Repo] ← single source of truth (server/data.json)
      ↑↓ git CLI              ↑↓ GitHub API
[Server PC]              [Remote Dashboard]
  server/index.js          dashboard-remote.html
  bot/index.js             (browser only, no server)
```

- **Server + Bot** use `simple-git` to pull on startup, commit + push on every change
- **Remote Dashboard** uses GitHub API to read/write `data.json`
- **Conflict handling**: auto-rebase on server, auto-retry on dashboard

---

## Discord Bot Commands

| Command | Description | Permission |
|---------|-------------|------------|
| `/link` | Link Discord account to reviewer | Everyone |
| `/review create` | Create review (auto-assign) | Linked users |
| `/review create-manual` | Create review with specific reviewers | Admin only |
| `/review approve` | Approve a review | Assigned reviewers |
| `/review reject` | Reject with comment | Assigned reviewers |
| `/review fix-done` | Mark fixes done, select who re-reviews | Merger |
| `/review escalate` | Escalate to senior | Merger / Scrum Master |
| `/review comment` | Add comment | Linked users |
| `/review status` | Show active reviews | Everyone |
| `/review details` | Show review details | Linked users |
| `/my-reviews` | Show your assigned reviews | Linked users |
| `/admin passwords` | View all passwords | Admin only |
| `/admin reset-password` | Reset user password | Admin only |
| `/admin set-password` | Set user password | Admin only |
| `/admin add-user` | Add new user | Admin only |
| `/admin remove-user` | Remove user | Admin only |
| `/admin set-role` | Change user role | Admin only |
| `/admin set-load` | Set reviewer load (0-999) | Admin only |
| `/admin unlink` | Remove Discord link | Admin only |
| `/admin reviewers` | Show all reviewers | Admin only |

---

## Data Structure

`server/data.json`:
```json
{
  "reviewers": [
    {
      "name": "John Doe",
      "load": 0,
      "speciality": "Fullstack",
      "role": "reviewer",
      "email": "",
      "password": "$2b$...",
      "plainPassword": "abc123",
      "discordId": ""
    }
  ],
  "reviews": [...],
  "settings": {
    "reviewersPerRequest": 3,
    "maxLoad": 3,
    "nextReviewNumber": 1
  }
}
```

---

## Git History as Audit Trail

Every change is auto-committed with a descriptive message:
```bash
git log --oneline server/data.json
# abc1234 Review REV-5 created: feature/auth-login
# def5678 Review REV-5 approved by Reviewer16
# ghi9012 Load set to 2 for Reviewer01
# jkl3456 Password reset for Reviewer03

git show abc1234  # See what changed
git log -p server/data.json  # Full diff history
```
