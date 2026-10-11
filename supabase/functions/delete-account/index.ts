// Supabase Edge Function (Deno): deletes the caller's account, private photos and all cloud rows.
// Requires the user's own JWT; uses the service role only inside the function.
import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  {
    auth: { persistSession: false },
  },
);
const headers = { 'Content-Type': 'application/json' };
const BUCKET = 'progress-photos';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('{}', { status: 405, headers });
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token)
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
      status: 401,
      headers,
    });
  const { data, error } = await admin.auth.getUser(token);
  const userId = data.user?.id;
  if (error || !userId)
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
      status: 401,
      headers,
    });

  try {
    // 1. Private photo objects under the user's folder (paginated).
    for (;;) {
      const { data: files } = await admin.storage.from(BUCKET).list(userId, { limit: 100 });
      if (!files || files.length === 0) break;
      await admin.storage.from(BUCKET).remove(files.map((f) => `${userId}/${f.name}`));
      if (files.length < 100) break;
    }
    // 2. Auth user — cloud tables reference auth.users with ON DELETE CASCADE.
    const del = await admin.auth.admin.deleteUser(userId);
    if (del.error) throw del.error;
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  } catch {
    console.error('delete-account: failed');
    return new Response(JSON.stringify({ ok: false, error: 'server_error' }), {
      status: 500,
      headers,
    });
  }
});
