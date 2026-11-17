'use strict';
(() => {
  const config = window.POSYANDU_SUPABASE_CONFIG || {};
  const key = typeof config.anonKey === 'string' ? config.anonKey.trim() : '';
  const isLegacyServiceRole = (() => {
    try {
      const payload = key.split('.')[1];
      if (!payload) return false;
      const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
      const json = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')));
      return json.role === 'service_role';
    } catch { return false; }
  })();
  const isSecretPrefix = key.startsWith('sb_secret_');
  const configured = typeof config.url === 'string'
    && /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.url)
    && key.length > 20
    && !key.includes('ISI_SUPABASE')
    && !isSecretPrefix
    && !isLegacyServiceRole;

  // A secret/service_role key is deliberately rejected in the browser.
  window.posyanduSupabaseConfigured = configured && !!window.supabase?.createClient;
  window.posyanduSupabase = window.posyanduSupabaseConfigured
    ? window.supabase.createClient(config.url, key, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        flowType: 'pkce'
      }
    })
    : null;
})();
