# Together Tasks — GitHub files

This is a mobile-first group task manager that can be hosted directly on GitHub Pages. It includes:

- Email/password sign-up and sign-in
- Create a group or join with a six-character invite code
- Shared tasks with status, priority, due date and assignee
- Overview statistics and completion progress
- Task search and filters
- Team member list and copyable invite code
- Responsive desktop sidebar and mobile bottom navigation
- Demo preview using browser storage before Supabase is connected

## Upload to GitHub

1. Create a new GitHub repository.
2. Upload **all files from this folder to the repository root**.
3. `config.js` is already connected to Supabase project `svulztymbvknixuktmap` with its publishable key.
4. In GitHub, open **Settings → Pages**.
5. Under **Build and deployment**, choose **Deploy from a branch**.
6. Select the `main` branch and `/ (root)`, then save.

GitHub will provide the public website URL after deployment.

## Before connecting the website

Run `schema.sql` from the separate Supabase package in the Supabase SQL Editor. In Supabase Authentication settings, enable Email authentication. Add your GitHub Pages URL to **Authentication → URL Configuration → Redirect URLs**.

## Security

Only use the anon/publishable key in `config.js`. Never place the Supabase `service_role` key in GitHub or browser code. Database access is protected by the Row Level Security policies in `schema.sql`.
