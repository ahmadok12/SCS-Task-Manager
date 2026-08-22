# SCS Task Management Portal

Separate, mobile-first operations portal for Shaikh China Sourcing. It uses the same Supabase project as the existing admin panel, but every new table begins with `tm_`, so current functionality is not replaced.

## Included

- Customer orders with multiple products, MOQ, specifications and delivery details
- Custom Kanban stages
- Mouse and touch drag-and-drop
- Team and individual task assignments
- Sourcing, social-media and logistics permissions
- Order-specific group chat
- Automatic permanent timeline entries
- Realtime task, chat and timeline updates
- Private product-image storage bucket for the next upload module

## Part 1 — Set up Supabase

1. Open the Supabase project `nmhicufwamcrgbilmday`.
2. Open **SQL Editor** and select **New query**.
3. Open `supabase/01_schema.sql`, copy all its contents, paste them into the query and press **Run**.
4. Open **Authentication → Users**.
5. Select **Add user → Create new user** and create your administrator email/password. Enable automatic confirmation if the dashboard offers the option.
6. Open `supabase/02_add_team_members.sql`.
7. Replace `YOUR_ADMIN_EMAIL` with exactly the email created in step 5, then run the SQL.
8. Create each additional staff user under **Authentication → Users**. Copy the commented team-member block, enter their email/name/role, and run it.

Do not add customer accounts to `tm_profiles`. Only internal team members listed there can enter the task portal.

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
