# Queen City Maid Security and Recovery

## Current Local Deployment

- PostgreSQL and the application listen only on `127.0.0.1`.
- PostgreSQL requires SCRAM-SHA-256 authentication and uses data checksums.
- The application uses a DML-only runtime role. A separate owner role applies
  migrations.
- Passwords use salted `scrypt` hashes. Session tokens are random, stored as
  SHA-256 hashes, expire after seven days, and use Secure, HttpOnly, SameSite
  cookies on the HTTPS demo.
- Unsafe browser requests must have the same origin as the application.
- Login throttling is stored in PostgreSQL and survives application restarts.
- API responses are not cached. HTTPS responses include HSTS.
- Customer, employee, scheduling, finance, payroll, and account changes are
  audited where supported by their workflows.

## Backup and Recovery

- A Windows task runs at 2:00 AM daily and starts when next available if the
  scheduled time was missed.
- Backups use PostgreSQL custom format, include a SHA-256 checksum, and are kept
  for 30 days.
- Every backup is restored into a disposable database and checked for
  migrations, organizations, users, and business settings before it is marked
  successful.
- `npm run security:status` checks the API, PostgreSQL, runtime privileges,
  scheduled task, backup age, and backup checksum.

The local backups are on the same computer as the database. They protect
against application mistakes and many database failures, but not theft, disk
loss, ransomware, or destruction of the computer.

## Production Gate

Do not enter real customer, payroll, access-code, or payment-ledger data until
all of the following are complete:

1. Deploy the application and PostgreSQL to managed infrastructure.
2. Enable encrypted automated backups in a separate failure domain.
3. Enable point-in-time recovery and define retention.
4. Complete and record a restore drill from the managed backup.
5. Store application and database credentials in a managed secret store.
6. Require verified TLS between the application and PostgreSQL.
7. Replace all demo passwords and enable manager MFA.
8. Add external alerts for backup failures, database health, storage capacity,
   and suspicious authentication activity.
9. Define recovery point and recovery time objectives with the business.

## Local Operations

```powershell
npm run db:start
npm run db:backup
npm run db:verify-backup
npm run db:status
npm run security:status
```

Managers can replace their own password from Settings > Security. The known
demo password must not be used after real data is introduced.
