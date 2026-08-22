# Cloudflare R2 attachment setup

This portal stores attachment bytes in a private Cloudflare R2 bucket. Supabase stores only the file metadata and checks which signed-in team members may access each order.

## Before starting

You need:

- The deployed GitHub Pages address for this portal
- Access to the connected Cloudflare account
- Access to Supabase project `nmhicufwamcrgbilmday`

## Step 1 — Update Supabase

1. Open Supabase project `nmhicufwamcrgbilmday`.
2. Open **SQL Editor → New query**.
3. Copy the entire updated `supabase/01_schema.sql` file into the editor.
4. Press **Run**.
5. Confirm that `tm_attachments` appears under **Table Editor**.

The schema is designed to be rerun. Existing portal orders and tasks are not removed.

## Step 2 — Create the private R2 bucket

1. Open the [Cloudflare dashboard](https://dash.cloudflare.com/).
2. Select **R2 Object Storage**.
3. If Cloudflare asks you to enable R2, complete that one-time activation.
4. Select **Create bucket**.
5. Enter the bucket name `scs-task-attachments`.
6. Leave the location on **Automatic** unless you have a specific compliance requirement.
7. Create the bucket.
8. Do not enable public access or an `r2.dev` public URL. Attachments must remain private.

## Step 3 — Create the attachment Worker

1. In Cloudflare, open **Workers & Pages**.
2. Select **Create application → Create Worker**.
3. Name it `scs-task-attachments` and deploy the starter Worker.
4. Open the Worker and select **Edit code**.
5. Delete the starter code.
6. Open `cloudflare-worker/src/index.js` from this package, copy all its contents, and paste it into the Worker editor.
7. Select **Save and deploy**.

## Step 4 — Bind the R2 bucket

1. Open the Worker’s **Settings → Bindings**.
2. Select **Add binding**.
3. Choose **R2 bucket**.
4. Set the variable name to `ATTACHMENTS` exactly.
5. Select the `scs-task-attachments` bucket.
6. Save the binding.

## Step 5 — Add Worker variables

In the Worker’s **Settings → Variables and Secrets**, add these variables:

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | `https://nmhicufwamcrgbilmday.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_fPCJf1ElcUQ7QjhIsSYQ5w_HJWi0YT-` |
| `ALLOWED_ORIGINS` | `https://ahmadok12.github.io` |
| `MAX_FILE_SIZE` | `26214400` |

Use only the origin for `ALLOWED_ORIGINS`: do not include the repository path or a trailing slash. For two permitted sites, separate their origins with a comma.

After saving the variables, deploy the Worker again if Cloudflare requests it.

## Step 6 — Test the Worker

1. Copy the Worker address. It will resemble `https://scs-task-attachments.your-subdomain.workers.dev`.
2. Open that address with `/health` added to the end.
3. A working service returns:

```json
{"ok":true}
```

## Step 7 — Connect the portal

1. Open `config.js` in the GitHub repository.
2. Replace `YOUR_CLOUDFLARE_WORKER_URL` with the Worker address from Step 6. Do not include a trailing slash.
3. Commit the change.
4. Wait for the GitHub Pages deployment to complete.

Example:

```js
attachmentApiUrl: 'https://scs-task-attachments.your-subdomain.workers.dev'
```

## Step 8 — Test attachments

1. Sign in to the task portal.
2. Open an order.
3. Select **Attachments**.
4. Upload a small PDF or image.
5. Confirm that it appears in the list and timeline.
6. Download it again.
7. Sign in as a user who cannot access that order and verify that the attachment is not visible.

## File rules

- Maximum size: 25 MB per attachment
- Accepted: PDF, JPG, PNG, WebP, GIF, Word, Excel, TXT, CSV and ZIP
- R2 bucket remains private
- Download and deletion require a valid Supabase session
- Users can delete their own attachments; administrators can delete any attachment they can access

## Optional command-line deployment

The `cloudflare-worker` directory is also ready for Wrangler. After editing `ALLOWED_ORIGINS` in `wrangler.toml`:

```bash
cd cloudflare-worker
npm install
npx wrangler login
npx wrangler r2 bucket create scs-task-attachments
npx wrangler deploy
```

Do not run the bucket-create command if the bucket was already created in the dashboard.
