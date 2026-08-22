# Cloudflare R2 attachment service

The existing private bucket and Worker are reused with a fresh Phase 1 API.

## Configuration

`cloudflare-worker/wrangler.toml` contains:

- Worker name: `scs-task-attachments`
- R2 binding: `ATTACHMENTS`
- Bucket: `scs-task-attachments`
- Allowed browser origin: `https://ahmadok12.github.io`
- Maximum file size: 25 MB

The Worker validates the Supabase access token on every request, verifies that the signed-in user can read the inquiry, and then reads or writes the private R2 object. The bucket is never public.

## Deploy or update

```bash
cd cloudflare-worker
npm ci
npm run deploy
```

After deployment, check:

```text
https://scs-task-attachments.ezychinadirect.workers.dev/health
```

The expected response is `{ "ok": true, "service": "scs-inquiry-attachments" }`.

## Supported file categories

- Client photos
- Photos shared to the client
- Quote
- Payment proof
- Other

Supported formats are JPEG, PNG, WebP, GIF, PDF, Word and Excel.
