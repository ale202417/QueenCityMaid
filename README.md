# Queen City Maid Operations

Production operations platform for Queen City Maid.

The approved product specification is maintained in the existing planning
workspace at `../local-workflow-mvp/PRODUCTION_PLAN.md`.

API details are in [API.md](API.md), [API_SALES.md](API_SALES.md), and
[API_FINANCE.md](API_FINANCE.md). Production requirements and release steps are
in [DEPLOYMENT.md](DEPLOYMENT.md).

## Local setup

1. Copy `.env.example` to `.env` and set `DATABASE_URL`.
2. Run `npm install`.
3. Run `npm run migrate`.
4. Run `npm run seed`.
5. Run `npm run dev:api` and `npm run dev` in separate terminals.

The manager application runs at `http://127.0.0.1:5180` and the API at
`http://127.0.0.1:4010`.

For local UI work without PostgreSQL credentials, run `npm run dev:api:memory`.
This development-only server applies the same migrations and uses:

- Email: `manager@queencitymaid.local`
- Password: `manager123!`

Cleaner route testing:

- Email: `captain@queencitymaid.local`
- Password: `manager123!`
- Email: `cleaner@queencitymaid.local`
- Password: `manager123!`

Run `npm run test:all` for the API suite, production build, and browser-level
workflow checks. Run `npm run test:migration-upgrade` with a PostgreSQL owner
connection to verify the previous-release upgrade path. Browser artifacts for
failed runs are written under `.cache/`.

For a production-style local run, execute `npm run build` and then
`npm run server`; the server hosts both the web app and API.

## Managed deployment

The repository includes a [Render Blueprint](render.yaml), GitHub Actions CI,
a clean production-manager bootstrap, and a hosted smoke check. Follow
[DEPLOYMENT.md](DEPLOYMENT.md) for the permanent web service and PostgreSQL
rollout. Do not run the demo seed against the production database.
