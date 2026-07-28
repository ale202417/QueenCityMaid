# Reporting API

All routes require an authenticated `manager` and are mounted below `/api`.
Money is returned as integer cents. Date ranges are inclusive and use
`YYYY-MM-DD`.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/dashboard` | Current employees, clients, weekly services, pay-period revenue and wages, and customer balances due |
| `GET` | `/reports/financial` | Generate payroll-period, monthly, or yearly financial results |
| `GET` | `/reports/compare` | Compare two date ranges and classify the trend |
| `GET` | `/expenses?from=...&to=...` | List recorded operating expenses |
| `POST` | `/expenses` | Record supplies, fuel, equipment, software, or another expense |
| `PATCH` | `/expenses/:id` | Correct a recorded expense |
| `POST` | `/expenses/:id/void` | Void an expense with a required reason while preserving history |

## Financial Reports

Monthly and yearly reports use:

```text
GET /reports/financial?kind=monthly&from=2026-07-01&to=2026-07-31
GET /reports/financial?kind=yearly&from=2026-01-01&to=2026-12-31
```

Payroll reports require a stored payroll period. Its authoritative start and
end dates replace the supplied range:

```text
GET /reports/financial?kind=payroll&from=2026-07-06&to=2026-07-19&payrollPeriodId=UUID
```

Results include collected revenue, charges, outstanding balances, wages,
operating expenses, total expenses, profit, collection rate, average revenue
per completed service, and completed services by type. Monthly and yearly
results also include retained customer counts and retention rate.

## Comparison

```text
GET /reports/compare?fromA=2026-06-01&toA=2026-06-30&fromB=2026-07-01&toB=2026-07-31
```

The comparison includes absolute and percentage changes for revenue, expenses,
profit, service volume, average revenue per service, and collection rate. The
overall trend is `growth`, `stable`, or `decline`.

## Expense Body

```json
{
  "spentOn": "2026-07-15",
  "category": "supplies",
  "description": "Cleaning supplies",
  "amountCents": 12500
}
```
