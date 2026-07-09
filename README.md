# Review Maker

Review assignment system with load balancing, role-based access, Discord bot integration, web dashboard, and optional GitLab auto-sync.

## Features

- **Web Dashboard** — Create reviews, manage reviewers, track approvals with deadlines
- **Discord Bot** — Full review management via slash commands with interactive buttons
- **Auto-Assignment** — Load-balanced reviewer selection with specialty matching
- **Smart Rotation** — Shuffles reviewers within same load groups to prevent selection bias
- **Deadline Management** — Priority-based deadlines (Imp=5d, Mid=7d, Low=10d) with overdue highlighting
- **Review Lifecycle** — `in_review → fix_needed → fix_made → approved / rejected / escalated`
- **GitLab Integration** — Auto-fetches open MRs, auto-closes reviews when MR is merged
- **Auto-Reassign** — When a reviewer leaves or is removed, active reviews are reassigned
- **Discord Linking** — `/link` to connect Discord account, self-registration option
- **Role-Based Access** — reviewer, senior, admin, manager, scrum_master with different permissions
- **Per-Reviewer Limits** — Individual maxLoad, weeklyCount, maxActiveReviews, disabled toggle
- **Rate Limited** — 5 login attempts per 15 minutes, password ops rate-limited
- **Crash-Resistant** — Unhandled exception logging, auto-restart loops
- **Audit Trail** — Every change logged with timestamp

## Quick Start

### Prerequisites
- Node.js v18+
- A Discord Bot Token and Client ID

### 1. Clone & Install
```bash
git clone https://github.com/Artur-Nayman/Review-Maker.git
cd Review-Maker
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```
Edit `.env` with your Discord credentials (see below).

### 3. Get Discord Credentials
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application → Bot → Reset Token → copy token
3. Enable **Server Members Intent** and **Message Content Intent**
4. OAuth2 → copy **Client ID**
5. Right-click your server → Copy ID (with Developer Mode ON)
6. Invite the bot:
   ```
   https://discord.com/oauth2/authorize?client_id=CLIENT_ID&permissions=8&scope=bot%20applications.commands
   ```

### 4. Deploy Commands & Start
```bash
npm run bot:deploy
npm run all
```

Dashboard: `http://localhost:3000`

## Discord Commands

### General
| Command | Description |
|---------|-------------|
| `/link` | Link Discord to reviewer account (or self-register) |
| `/my-reviews` | Show your assigned reviews |
| `/review create` | Create review with auto-assignment |
| `/review approve` | Approve a review |
| `/review reject` | Reject with comment |
| `/review fix-done` | Mark fixes completed |
| `/review escalate` | Escalate to senior reviewer |
| `/review details` | Show full review details |
| `/review status` | Show all active reviews |
| `/history` | Recent system activity |

### Admin Only
| Command | Description |
|---------|-------------|
| `/admin add-user` | Add new user (auto-generates password) |
| `/admin remove-user` | Remove user (auto-reassigns reviews) |
| `/admin set-role` | Change user role |
| `/admin set-load` | Set reviewer load |
| `/admin reviewers` | List all reviewers |
| `/admin workload` | Show loads and capacities |
| `/admin passwords` | View all passwords |
| `/admin settings` | View/edit system settings |
| `/admin unlink` | Remove Discord link |

## Roles

| Role | Can Review | Dashboard | Permissions |
|------|-----------|-----------|-------------|
| reviewer | Yes | Limited | Approve/reject, create reviews |
| senior | Yes | Limited | Escalation decisions |
| admin | Yes | Full | Full access |
| manager | No | Read/Write | Manage reviews |
| scrum_master | No | Read-only | View + escalate |

## Review Statuses

- `in_review` — Awaiting approvals
- `fix_needed` — Reviewer(s) requested changes
- `fix_made` — Fixes done, re-review pending
- `escalated` — Sent to senior reviewer
- `approved` — All approvals received
- `rejected` — Rejected after escalation

## Priority & Deadlines

| Priority | Deadline |
|----------|----------|
| imp | 5 days |
| mid | 7 days (default) |
| low | 10 days |

## Architecture

```
[Discord] ←→ [Bot + Express API + SQLite] ←→ [GitLab API]
                    ↕                          [Google Sheets]
              [Web Dashboard]
```

- **Server + Bot** share a SQLite database
- **Auto-deploy**: bot auto-pulls from Git, installs, restarts on changes
- **GitLab Sync**: polls open/merged MRs every 5 minutes
- **Rate Limiting**: login (5/15min), password ops (10/15min)

## Security

- Passwords hashed with bcrypt (10 rounds)
- Commands deployed to guild only (not global)
- Rate-limited authentication endpoints
- Role-based access control on all operations
- Audit log tracks all data changes

## Tests

```bash
npm test
```

## License

MIT
