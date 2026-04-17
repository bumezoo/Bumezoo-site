/**
 * Bumezoo Storage Worker
 * Worker name : bumezoo-storage
 * R2 bucket   : bumezoo-vault
 * Binding     : MY_BUCKET
 *
 * Routes:
 *   POST   /upload          — upload a file
 *   GET    /files           — list all files
 *   GET    /file/:filename  — download a file
 *   DELETE /file/:filename  — delete a file
 *
 * Every request must include the header:
 *   X-Auth-Key: bumezoo2026
 */

// ─────────────────────────────────────
// CONFIG
// ─────────────────────────────────────
const AUTH_KEY       = 'bumezoo2026';
const ALLOWED_ORIGIN = 'https://bumezoo.com';

// ─────────────────────────────────────
// CORS HEADERS
// Added to every response so the browser
// accepts the reply from the Worker.
// ─────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'X-Auth-Key, Content-Type',
};

// ─────────────────────────────────────
// HELPER — build a JSON response
// ─────────────────────────────────────
function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS,
      ...extraHeaders,
    },
  });
}

// ─────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────
export default {
  async fetch(request, env) {
    const { method } = request;
    const { pathname } = new URL(request.url);

    // ── 1. Handle CORS preflight (OPTIONS) ──
    // Browsers send this before the real request.
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // ── 2. Auth check ──
    // Every request must include X-Auth-Key with the correct value.
    const authKey = request.headers.get('X-Auth-Key');
    if (authKey !== AUTH_KEY) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    // ── 3. Router ──
    // Match method + path to the right handler.

    // POST /upload
    if (method === 'POST' && pathname === '/upload') {
      return handleUpload(request, env);
    }

    // GET /files
    if (method === 'GET' && pathname === '/files') {
      return handleList(env);
    }

    // GET /file/:filename
    if (method === 'GET' && pathname.startsWith('/file/')) {
      const filename = decodeURIComponent(pathname.slice(6));
      return handleDownload(filename, env);
    }

    // DELETE /file/:filename
    if (method === 'DELETE' && pathname.startsWith('/file/')) {
      const filename = decodeURIComponent(pathname.slice(6));
      return handleDelete(filename, env);
    }

    // No route matched
    return jsonResponse({ error: 'Not Found' }, 404);
  },
};

// ─────────────────────────────────────
// HANDLER — POST /upload
// Reads the file from multipart form data
// and saves it to R2.
// ─────────────────────────────────────
async function handleUpload(request, env) {
  let formData;
  try {
    formData = await request.formData();
  } catch {
    return jsonResponse({ error: 'Invalid form data' }, 400);
  }

  const file = formData.get('file');

  if (!file || typeof file === 'string') {
    return jsonResponse({ error: 'No file provided' }, 400);
  }

  const filename    = file.name;
  const buffer      = await file.arrayBuffer();
  const contentType = file.type || 'application/octet-stream';

  // Save to R2 with metadata
  await env.MY_BUCKET.put(filename, buffer, {
    httpMetadata: { contentType },
    customMetadata: {
      uploadedAt: new Date().toISOString(),
      size:       String(file.size),
    },
  });

  return jsonResponse({ success: true, filename }, 201);
}

// ─────────────────────────────────────
// HANDLER — GET /files
// Returns a JSON list of every object
// stored in the R2 bucket.
// ─────────────────────────────────────
async function handleList(env) {
  const listed = await env.MY_BUCKET.list();

  const files = listed.objects.map(obj => ({
    name:     obj.key,
    size:     obj.size,
    uploaded: obj.uploaded,
    type:     obj.httpMetadata?.contentType || 'application/octet-stream',
  }));

  return jsonResponse({ files });
}

// ─────────────────────────────────────
// HANDLER — GET /file/:filename
// Streams the file back to the client
// as a download.
// ─────────────────────────────────────
async function handleDownload(filename, env) {
  const object = await env.MY_BUCKET.get(filename);

  if (!object) {
    return jsonResponse({ error: 'File not found' }, 404);
  }

  return new Response(object.body, {
    status: 200,
    headers: {
      ...CORS,
      'Content-Type':        object.httpMetadata?.contentType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

// ─────────────────────────────────────
// HANDLER — DELETE /file/:filename
// Removes the file from R2 permanently.
// ─────────────────────────────────────
async function handleDelete(filename, env) {
  // Check the file exists before trying to delete
  const exists = await env.MY_BUCKET.head(filename);

  if (!exists) {
    return jsonResponse({ error: 'File not found' }, 404);
  }

  await env.MY_BUCKET.delete(filename);

  return jsonResponse({ success: true, deleted: filename });
}
