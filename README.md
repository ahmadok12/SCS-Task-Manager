# SCS Task Management Portal

Separate, mobile-first operations portal for Shaikh China Sourcing. It uses the same Supabase project as the existing admin panel, but every new table begins with `tm_`, so current functionality is not replaced.

## Included

- Customer orders with multiple products, MOQ, specifications and delivery details
- Custom Kanban stages
- Mouse and touch drag-and-drop
- Team and individual task assignments
- Team self-sign-up with administrator approval
- Sourcing, social-media and logistics permissions
- Order-specific group chat
- Automatic permanent timeline entries
- Realtime task, chat and timeline updates
- Private product-image storage bucket for the next upload module

## Part 1 — Set up Supabase

1. Open the Supabase project `nmhicufwamcrgbilmday`.
2. Open **SQL Editor** and select **New query**.
3. Open `supabase/01_schema.sql`, copy all its contents, paste them into the query and press **Run**.
4. Deploy the GitHub files using Part 2 below, then open the deployed portal.
5. Select **New team member? Create account** and register your own administrator account.
6. Confirm the email sent by Supabase.
7. Open `supabase/02_activate_first_admin.sql`.
8. Replace `YOUR_ADMIN_EMAIL` with the administrator email registered in step 5, then run the SQL once.
9. Sign in to the portal. Your administrator account is ready.

All later team members create their own accounts from the portal. Their accounts remain blocked in **Pending approval**. An administrator opens **Team**, checks the requested department and selects **Approve**. No additional SQL is required for team members.

## Part 2 — Upload to GitHub

1. Create a new empty GitHub repository, for example `scs-task-manager`.
2. Upload everything inside this folder, including the `.github` folder.
3. Commit the files to the `main` branch.
4. Open **Settings → Pages**.
5. Under **Build and deployment**, set **Source** to **GitHub Actions**.
6. Open the **Actions** tab and wait for `Deploy SCS Task Manager` to finish.
7. Open the URL shown by the completed deployment.

## Part 3 — Supabase URL settings

After GitHub provides the final URL:

1. Open Supabase **Authentication → URL Configuration**.
2. Set **Site URL** to the GitHub Pages URL.
3. Add the same URL under **Redirect URLs**. Also add the version ending in `/**`.

Keep **Confirm email** enabled under **Authentication → Providers → Email** so a team member must verify ownership of the email address before approval.

## Safe test-data cleanup

The task portal uses only `tm_` tables. To remove portal test orders, tasks, chats and timeline records while preserving users and board stages, run:

```sql
truncate table public.tm_orders cascade;
```

This does not delete tables from the attached customer-order admin panel.

## Important security notes

- `config.js` contains only the browser-safe Supabase publishable key.
- Never place a secret key or `service_role` key in GitHub files.
- Row Level Security is enabled for every portal table.
- Permissions are enforced in the database, not only hidden in the interface.
- Social-media and logistics staff see an order only when their team has a task on that order.
- A new user cannot choose their own active role. The requested department is informational until an administrator approves it.
