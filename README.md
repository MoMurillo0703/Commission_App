# Commissions App

Internal application for importing carrier commission statements, reconciling groups and insurance products, assigning production credit to agents, and reporting commissions at agency and agent levels.

## Initial vertical slice

`upload Excel -> map columns -> validate rows -> match group/product/agent -> review exceptions -> post statement -> agency and agent reports`

PDF statements will enter the same validation and review pipeline after carrier-specific extraction is added.

Hosted demo setup (GitHub, Vercel, Supabase) is documented in `DEPLOYMENT.md`. Use `.env.example` for required variable names. Do not commit real credentials.

