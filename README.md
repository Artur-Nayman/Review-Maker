# Review Maker


Review assignment system with load balancing, role-based access, Discord bot integration, and Google Sheets sync.

## Features

- **Web Dashboard** — Create reviews, manage reviewers, track approvals
- **Discord Bot** — Full review management via slash commands
- **Git-synced Data** — `data.json` is tracked in Git, auto-commits on every change

- **Google Sheets Sync** — Review queue automatically synced to Google Sheets
- **Reviewer Capacity Control** — Simultaneous load limit + weekly cap + large review limit
- **Commit-Based Reviews** — Support for branch reviews and 1–3 commit hash reviews
- **Auto-Sizing** — Reviews auto-sized (small / medium / large) based on type and commits
- **Load Balancing** — Automatic reviewer assignment with specialty matching
- **Standalone Remote Dashboard** — Browser-only dashboard that talks directly to GitHub
- **Password Management** — Pre-generated passwords, admin-only visibility

## Quick Start (Local PC / Server)


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
# Required
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_client_id_here
DISCORD_GUILD_ID=your_server_id_here

# Google Sheets sync (optional)
GOOGLE_SHEET_ID=your_sheet_id
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
GOOGLE_SERVICE_ACCOUNT_PATH=/path/to/credentials.json

# Server
PORT=3000
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

## Setup Guide

### Creating a Google Service Account (for Sheets Sync)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable **Google Sheets API**
4. Go to **IAM & Admin** → **Service Accounts** → **Create Service Account**
5. Create a key → **JSON** → download
6. Share your Google Sheet with the service account email (viewer/edit)
7. Set `GOOGLE_SERVICE_ACCOUNT_PATH` in `.env` to the JSON file path, or paste the full JSON into `GOOGLE_SERVICE_ACCOUNT_JSON`

### Finding Your Google Sheet ID

The Sheet ID is the long string in the URL:
```
https://docs.google.com/spreadsheets/d/THIS_IS_THE_SHEET_ID/edit
```

---

## Google Sheets Sync

When configured, every review state change is automatically synced to the **Review Queue** tab:
- New review → row added
- Approval count updated → approvals column updated
- Status change → status updated
- Startup → full bulk sync

Branch names are scanned for MR IIDs (`!123` pattern) and auto-filled in the Linked MR IID column.

---

## Reviewer Capacity

Two limits per reviewer, both enforced:

| Check | What It Blocks | Default |
|-------|---------------|---------|
| **Simultaneous load** (`maxLoad`) | Max concurrent active reviews | 3 |
| **Weekly cap** (`maxWeeklyReviews`) | Max total reviews per week | 5 |
| **Large limit** (`maxLargeSimultaneous`) | How many large reviews at once | 1 |

Weekly counts auto-reset on Monday 00:00.

---

## Discord Bot Commands

| Command | Description | Permission |
|---------|-------------|------------|
| `/link` | Link Discord account to reviewer | Everyone |
| `/review create` | Create review (auto-assign) | Linked users |
| `/review create-manual` | Create review with specific reviewers | Admin only |
| `/review create-commit` | Create review from 1-3 commit hashes | Linked users |
| `/review approve` | Approve a review | Assigned reviewers |
| `/review reject` | Reject with comment | Assigned reviewers |
| `/review fix-done` | Mark fixes done, select who re-reviews | Merger |
| `/review escalate` | Escalate to senior | Merger / Scrum Master |
| `/review comment` | Add comment | Linked users |
| `/review status` | Show active reviews | Everyone |
| `/review details` | Show review details | Linked users |
| `/my-reviews` | Show your assigned reviews | Linked users |
| `/admin workload` | Show reviewer load, weekly count, capacity | Admin only |
| `/admin dashboard` | Full system status summary | Admin only |
| `/admin settings` | View/edit system settings | Admin only |
| `/admin set-weekly` | Reset a reviewer's weekly count | Admin only |
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

## Architecture

```
                    [GitHub Repo] ← single source of truth (server/data.json)
                          ↑↓ git CLI              ↑↓ GitHub API
                    [Server PC]              [Remote Dashboard]
[Google Sheets] ←── server/index.js          dashboard-remote.html
                    bot/index.js             (browser only, no server)
                        |
[sheets-sync.js] ───────┘
  (fires on every saveData call)
```

- **Server + Bot** use `simple-git` to pull on startup, commit + push on every change
- **Remote Dashboard** uses GitHub API to read/write `data.json`
- **Google Sheets Sync** fires on every `saveData` call — pushes all active reviews to the Review Queue tab
- **Conflict handling**: auto-rebase on server, auto-retry on dashboard

---

## Data Structure

`server/data.json`:
```json
{
  "reviewers": [
    {
      "name": "John Doe",
      "load": 0,
      "weeklyCount": 0,
      "weeklyResetAt": "2026-05-28T00:00:00.000Z",
      "currentLargeReview": false,
      "maxActiveReviews": 5,
      "maxLargeSimultaneous": 1,
      "maxLoad": 3,
      "speciality": "Fullstack",
      "role": "reviewer",
      "email": "",
      "password": "$2b$...",
      "plainPassword": "abc123",
      "discordId": ""
    }
  ],
  "reviews": [
    {
      "id": "REV-123",
      "reviewType": "branch",
      "branch": "feature/new-feature",
      "commits": [],
      "merger": "Developer Name",
      "reviewers": [
        { "name": "Reviewer A", "status": "pending", "notified": false }
      ],
      "approvalCount": 0,
      "reviewersPerRequest": 3,
      "status": "open",
      "type": "feature",
      "priority": "medium",
      "size": "medium",
      "createdAt": "2026-05-28T10:00:00.000Z"
    }
  ],
  "settings": {
    "reviewersPerRequest": 3,
    "maxLoad": 3,
    "maxWeeklyReviews": 5,
    "maxLargeSimultaneous": 1,
    "nextReviewNumber": 1
  }
}
```

### Review Types
- **branch** (default) — review a feature branch
- **commit** — review 1-3 specific commit hashes (no branch merge)

### Sizes
- **small** — bugfix, chore, test, revert
- **medium** — feature, refactor, perf
- **large** — epic, draft (locks reviewer's large slot)

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
