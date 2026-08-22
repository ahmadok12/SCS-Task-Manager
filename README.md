# SCS Inquiry Workspace — Phase 1

A mobile-first browser app and installable PWA for capturing customer inquiries before they become operational tasks.

## Phase 1 features

- Responsive inquiry cards for phone, tablet and desktop
- Search, status filters, sorting and dashboard counts
- Customer, company, contact and delivery details
- Multiple products with quantities, units and specifications
- Individually editable inquiry fields
- Quote amount, currency, notes and payment notes
- Private categorized R2 attachments: client photos, shared photos, quotes and payment proof
- Inquiry comments with a database notification for every registered user
- Live notification badge and browser alerts while the app/PWA is running
- Email/password team authentication with Row Level Security
- Installable PWA with offline app-shell support

## Connected services

- Supabase project: `nmhicufwamcrgbilmday`
- Cloudflare Worker: `scs-task-attachments.ezychinadirect.workers.dev`
- R2 bucket binding: `scs-task-attachments`
- GitHub Pages repository: `ahmadok12/SCS-Task-Manager`

## Database

The complete fresh schema is in `supabase/01_fresh_phase_1.sql`. It removes the old `tm_*` application tables, preserves Supabase Auth accounts, and creates six RLS-protected Phase 1 tables.

## Deployment

Pushing `main` runs `.github/workflows/deploy-pages.yml`. The site is published through GitHub Pages. The Cloudflare Worker is deployed separately from `cloudflare-worker` with `npm run deploy`.

Only the browser-safe Supabase publishable key is committed. Never put a Supabase secret or service-role key in this repository.
