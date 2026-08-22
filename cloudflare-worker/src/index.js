const ALLOWED_TYPES = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);
const FILE_KINDS = new Set(['client_photo', 'shared_photo', 'quote', 'payment_proof', 'other']);

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = allowedOrigin(origin, env.ALLOWED_ORIGINS);
    const cors = corsHeaders(origin, allowed);
    if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: cors });
    if (origin && !allowed) return json({ error: 'Origin not allowed' }, 403, cors);

    try {
      const url = new URL(request.url);
      if (url.pathname === '/health') return json({ ok: true, service: 'scs-inquiry-attachments' }, 200, cors);
      const match = url.pathname.match(/^\/inquiries\/([0-9a-f-]+)\/files(?:\/([0-9a-f-]+))?$/i);
      if (!match) return json({ error: 'Not found' }, 404, cors);

      const inquiryId = match[1];
      const fileId = match[2] || null;
      const token = bearerToken(request);
      const user = await authenticatedUser(env, token);
      await assertInquiryAccess(env, token, inquiryId);

      if (request.method === 'POST' && !fileId) return uploadFile(request, env, token, user.id, inquiryId, cors);
      if (request.method === 'GET' && fileId) return downloadFile(env, token, inquiryId, fileId, cors);
      if (request.method === 'DELETE' && fileId) return deleteFile(env, token, inquiryId, fileId, cors);
      return json({ error: 'Method not allowed' }, 405, cors);
    } catch (error) {
      const status = Number(error.status) || 500;
      return json({ error: status === 500 ? 'Attachment service error' : error.message }, status, cors);
    }
  }
};

async function uploadFile(request, env, token, userId, inquiryId, cors) {
  const form = await request.formData();
  const file = form.get('file');
  const fileKind = String(form.get('file_kind') || 'other');
  if (!(file instanceof File)) throw httpError(400, 'A file is required');
  if (!FILE_KINDS.has(fileKind)) throw httpError(400, 'Invalid attachment category');
  const max = Number(env.MAX_FILE_SIZE || 26214400);
  if (!file.size || file.size > max) throw httpError(413, 'File must be between 1 byte and 25 MB');
  if (!ALLOWED_TYPES.has(file.type)) throw httpError(415, 'This file type is not allowed');

  const cleanName = sanitizeName(file.name);
  const objectKey = `inquiries/${inquiryId}/${crypto.randomUUID()}/${cleanName}`;
  await env.ATTACHMENTS.put(objectKey, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { inquiryId, uploaderId: userId, fileKind, originalName: cleanName }
  });

  const result = await supabase(env, token, '/rest/v1/inquiry_files', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ inquiry_id: inquiryId, file_kind: fileKind, file_name: cleanName, object_key: objectKey, mime_type: file.type, size_bytes: file.size, uploaded_by: userId })
  });
  if (!result.ok) { await env.ATTACHMENTS.delete(objectKey); throw httpError(result.status, await apiError(result)); }
  return json({ file: (await result.json())[0] }, 201, cors);
}

async function downloadFile(env, token, inquiryId, fileId, cors) {
  const row = await getFile(env, token, inquiryId, fileId);
  const object = await env.ATTACHMENTS.get(row.object_key);
  if (!object) throw httpError(404, 'Attachment file was not found');
  const headers = new Headers(cors);
  headers.set('Content-Type', row.mime_type || 'application/octet-stream');
  headers.set('Content-Length', String(object.size));
  headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}`);
  headers.set('Cache-Control', 'private, no-store');
  return new Response(object.body, { status: 200, headers });
}

async function deleteFile(env, token, inquiryId, fileId, cors) {
  const row = await getFile(env, token, inquiryId, fileId);
  const result = await supabase(env, token, `/rest/v1/inquiry_files?id=eq.${fileId}&inquiry_id=eq.${inquiryId}`, { method: 'DELETE' });
  if (!result.ok) throw httpError(result.status, await apiError(result));
  await env.ATTACHMENTS.delete(row.object_key);
  return json({ deleted: true }, 200, cors);
}

async function getFile(env, token, inquiryId, fileId) {
  const result = await supabase(env, token, `/rest/v1/inquiry_files?select=id,inquiry_id,file_name,object_key,mime_type,size_bytes&id=eq.${fileId}&inquiry_id=eq.${inquiryId}&limit=1`);
  if (!result.ok) throw httpError(result.status, await apiError(result));
  const rows = await result.json();
  if (!rows.length) throw httpError(404, 'Attachment not found or access denied');
  return rows[0];
}

async function assertInquiryAccess(env, token, inquiryId) {
  const result = await supabase(env, token, `/rest/v1/inquiries?select=id&id=eq.${inquiryId}&limit=1`);
  if (!result.ok) throw httpError(result.status, await apiError(result));
  if (!(await result.json()).length) throw httpError(403, 'You do not have access to this inquiry');
}

async function authenticatedUser(env, token) {
  if (!token) throw httpError(401, 'Sign in is required');
  const result = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
  if (!result.ok) throw httpError(401, 'Invalid or expired session');
  return result.json();
}

function supabase(env, token, path, options = {}) { const headers = new Headers(options.headers || {}); headers.set('apikey', env.SUPABASE_PUBLISHABLE_KEY); headers.set('Authorization', `Bearer ${token}`); return fetch(`${env.SUPABASE_URL}${path}`, { ...options, headers }); }
function bearerToken(request) { const value = request.headers.get('Authorization') || ''; return value.startsWith('Bearer ') ? value.slice(7) : ''; }
function allowedOrigin(origin, configured = '') { return !origin || configured.split(',').map(v => v.trim()).filter(Boolean).includes(origin); }
function corsHeaders(origin, allowed) { const h = { 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }; if (origin && allowed) h['Access-Control-Allow-Origin'] = origin; return h; }
function sanitizeName(name) { const clean = String(name || 'attachment').normalize('NFKC').replace(/[\\/\x00-\x1f\x7f]/g, '-').replace(/\s+/g, ' ').trim(); return clean.slice(0, 180) || 'attachment'; }
function httpError(status, message) { const error = new Error(message); error.status = status; return error; }
async function apiError(response) { const body = await response.json().catch(() => ({})); return body.message || body.error || `Request failed (${response.status})`; }
function json(value, status, headers = {}) { const h = new Headers(headers); h.set('Content-Type', 'application/json; charset=utf-8'); h.set('Cache-Control', 'no-store'); return new Response(JSON.stringify(value), { status, headers: h }); }
