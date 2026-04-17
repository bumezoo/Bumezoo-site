/**
 * Bumezoo Storage Worker
 * Worker name : bumezoo-storage
 * R2 bucket   : bumezoo-vault
 * Binding     : MY_BUCKET
 */

const AUTH_KEY       = 'bumezoo2026';
const ALLOWED_ORIGIN = 'https://bumezoo.com';

const CORS = {
  'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'X-Auth-Key, Content-Type',
};

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extraHeaders },
  });
}

export default {
  async fetch(request, env) {
    const { method } = request;
    const { pathname } = new URL(request.url);

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const authKey = request.headers.get('X-Auth-Key');
    if (authKey !== AUTH_KEY) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    if (method === 'POST' && pathname === '/upload')
      return handleUpload(request, env);

    if (method === 'GET' && pathname === '/files')
      return handleList(env);

    if (method === 'GET' && pathname.startsWith('/file/'))
      return handleDownload(decodeURIComponent(pathname.slice(6)), env);

    if (method === 'DELETE' && pathname.startsWith('/file/'))
      return handleDelete(decodeURIComponent(pathname.slice(6)), env);

    return jsonResponse({ error: 'Not Found' }, 404);
  },
};

async function handleUpload(request, env) {
  let formData;
  try { formData = await request.formData(); }
  catch { return jsonResponse({ error: 'Invalid form data' }, 400); }

  const file = formData.get('file');
  if (!file || typeof file === 'string')
    return jsonResponse({ error: 'No file provided' }, 400);

  await env.MY_BUCKET.put(file.name, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
    customMetadata: { uploadedAt: new Date().toISOString(), size: String(file.size) },
  });

  return jsonResponse({ success: true, filename: file.name }, 201);
}

async function handleList(env) {
  const listed = await env.MY_BUCKET.list();
  const files = listed.objects.map(obj => ({
    name: obj.key, size: obj.size, uploaded: obj.uploaded,
    type: obj.httpMetadata?.contentType || 'application/octet-stream',
  }));
  return jsonResponse({ files });
}

async function handleDownload(filename, env) {
  const object = await env.MY_BUCKET.get(filename);
  if (!object) return jsonResponse({ error: 'File not found' }, 404);

  return new Response(object.body, {
    status: 200,
    headers: {
      ...CORS,
      'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

async function handleDelete(filename, env) {
  const exists = await env.MY_BUCKET.head(filename);
  if (!exists) return jsonResponse({ error: 'File not found' }, 404);

  await env.MY_BUCKET.delete(filename);
  return jsonResponse({ success: true, deleted: filename });
}
