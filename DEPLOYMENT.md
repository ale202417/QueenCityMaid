# Queen City Maid Deployment

## Required Services

- Node.js 22 or newer.
- PostgreSQL 16 or newer with encrypted storage and daily backups.
- HTTPS reverse proxy or managed application host.
- Business-owned SMS provider exposed through the configured webhook contract.

## Required Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Restricted application-runtime PostgreSQL connection |
| `MIGRATION_DATABASE_URL` | Separate schema-owner PostgreSQL connection |
| `PORT` | Web/API port; defaults to `4010` |
| `HOST` | API bind address; use `127.0.0.1` behind the local tunnel |
| `SESSION_COOKIE_SECURE` | Must be `true` behind production HTTPS |
| `TRUST_PROXY` | Set `true` when one trusted proxy sits in front of Node |
| `RUN_MIGRATIONS_ON_START` | Use `false` in production; migrations run before deployment |
| `BACKUP_RETENTION_DAYS` | Local verified-backup retention; defaults to `30` |
| `SMS_WEBHOOK_URL` | HTTPS endpoint that accepts `{to, body, idempotencyKey}` |
| `SMS_WEBHOOK_TOKEN` | Bearer credential for the SMS endpoint |

No payment account credentials are stored. Zelle, Venmo, PayPal, cash, and
check payments are manager-confirmed ledger entries.

## Release

```powershell
npm ci
npm test
npm run build
npm run migrate
npm run server
```

`npm run server` serves both the built React application and `/api` from one
origin. Migrations are idempotent; local startup runs them automatically, while
production runs them once as a pre-deploy command.

## Render Deployment

The repository-root `render.yaml` provisions:

- A paid Node web service in the Virginia region.
- A paid PostgreSQL 18 database in the same region.
- A production build and database migration before traffic changes.
- A database-backed `/api/health` deployment check.
- Automatic deployment only after GitHub CI passes.
- No public database IP access.

Create a Render Blueprint from the private Git repository. Render supplies the
internal database connection strings automatically. The first deployment uses
the database owner connection for both migration and runtime access only while
the empty system is being provisioned. Before real business data is entered,
create a restricted runtime database user and replace only `DATABASE_URL`;
leave `MIGRATION_DATABASE_URL` connected as the schema owner.

Do not run `npm run seed` in production because that command installs demo
customers, employees, schedules, and credentials. Create the first real manager
with the clean bootstrap command:

```text
npm run bootstrap:admin
```

Set `BOOTSTRAP_MANAGER_EMAIL`, `BOOTSTRAP_MANAGER_NAME`, and a unique
`BOOTSTRAP_MANAGER_PASSWORD` of at least 12 characters only for that command.
`BOOTSTRAP_ORGANIZATION_NAME` defaults to `Queen City Maid`. Remove the
temporary password setting after the command succeeds. Running the command
again does not duplicate the manager.

After Render provides the permanent HTTPS address:

```text
SITE_URL=https://your-service.onrender.com npm run smoke:production
```

The smoke check verifies the database health endpoint, API cache protection,
hidden server signature, HTTPS, and the application shell. Complete a managed
backup export and restore drill before importing real data.

## Updating The Hosted Application

1. Make and test changes on a feature branch.
2. Open a pull request and wait for GitHub CI.
3. Back up the production database before schema changes.
4. Merge to the production branch.
5. Render builds the new release and runs migrations before switching traffic.
6. Run `npm run smoke:production` against the permanent URL.

If the build, migration, startup, or health check fails, do not import data or
manually bypass the failed release.

## Persistent Local Demo

The local demo uses a dedicated PostgreSQL 18 cluster stored in the ignored
`.local-postgres` directory and listens only on `127.0.0.1:55432`.

```powershell
npm run db:start
npm run server
npm run db:backup
npm run db:verify-backup
npm run db:schedule-backups
npm run db:harden-files
npm run security:status
npm run db:stop
```

The server, migration, and seed commands load private settings from `.env`.
Application restarts do not reset this database. Local backups are written to
`.local-postgres/backups`, checksummed, and restored into a disposable database
for verification. A deployed business system still requires managed,
off-machine backups and point-in-time recovery.

## First Setup

1. Create the PostgreSQL database and set `DATABASE_URL`.
2. Set a unique `SEED_MANAGER_PASSWORD`, then run `npm run seed` once.
3. Sign in as the seeded manager and create the other manager and cleaner
   accounts.
4. Import or enter current customers, properties, employees, rates, and teams.
5. Confirm business settings and record text consent before enabling reminders.
6. Configure the SMS webhook and send a controlled test message.
7. Verify the next two weeks of bookings and routes before staff use begins.

## Operations

- Run encrypted database backups daily and test restoration quarterly.
- Retain payroll exports and audit events according to the accountant's policy.
- Review failed notifications each workday.
- Rotate database and SMS credentials immediately after any suspected exposure.
- Apply OS, Node, and dependency updates in a tested release.

The product is usable without SMS credentials, but messages stay failed or
queued until the business-owned provider is configured. Map optimization is
manual in this release; route order and travel estimates remain manager inputs.
