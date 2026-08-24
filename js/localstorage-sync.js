// Fast, reliable Supabase sync for the BeeOne Event app.
// localStorage is the instant local cache; Supabase is the shared database.
(function () {
  'use strict';

  if (!window.localStorage) return;

  document.addEventListener('DOMContentLoaded', function () {
    var tenant = new URLSearchParams(window.location.search).get('tenant');
    if (!tenant) return;
    document.querySelectorAll('a[href="index.html"]').forEach(function (link) {
      var home = new URL('index.html', window.location.href);
      home.searchParams.set('tenant', tenant);
      link.href = home.href;
    });
  });

  var originalSet = Storage.prototype.setItem;
  var originalRemove = Storage.prototype.removeItem;
  var originalClear = Storage.prototype.clear;
  var started = false;
  var hydrating = true;
  var applyingRemote = false;
  var pending = Object.create(null);
  var timers = Object.create(null);
  var preHydrationWrites = Object.create(null);
  var client = null;
  var realtimeChannel = null;
  var originalGet = Storage.prototype.getItem;

  function tenantId(){
    try {
      var sharedTenant = new URLSearchParams(window.location.search).get('tenant');
      if (sharedTenant) return String(sharedTenant);
    } catch (e) {}
    try {
      var session = JSON.parse(originalGet.call(sessionStorage, 'eventalk_admin_session') || originalGet.call(localStorage, 'eventalk_admin_session') || 'null');
      return session && session.tenantId ? String(session.tenantId) : 'default';
    } catch (e) { return 'default'; }
  }

  function scopedKey(key){
    if (tenantId() === 'default') return String(key);
    return 'tenant_' + tenantId().replace(/[^a-zA-Z0-9_-]/g, '_') + '__' + String(key);
  }

  function tenantStoragePrefix(){
    return tenantId() === 'default' ? '' : scopedKey('');
  }

  function isDataKey(key) {
    return (String(key).indexOf('eventalk_') === 0 && String(key).indexOf('eventalk_admin_') !== 0) || String(key) === 'homepage';
  }

  function parse(value) {
    try { return JSON.parse(value); }
    catch (e) { return { __raw: String(value) }; }
  }

  function sameData(a, b) {
    try { return JSON.stringify(a) === JSON.stringify(b); }
    catch (e) { return String(a) === String(b); }
  }

  function signal(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail: detail || {} })); }
    catch (e) {}
  }

  function queueSave(key, value, immediate) {
    if (!client) return;
    pending[key] = value;
    if (timers[key]) clearTimeout(timers[key]);
    timers[key] = setTimeout(function () {
      timers[key] = null;
      flush(key);
    }, immediate ? 0 : 50);
  }

  function flush(key) {
    if (!client || !Object.prototype.hasOwnProperty.call(pending, key)) return Promise.resolve();
    var value = pending[key];
    delete pending[key];

    return client.from('eventalk_content').upsert({
      key: scopedKey(key),
      data: parse(value),
      updated_at: new Date().toISOString()
    }, { onConflict: 'key' }).then(function (result) {
      if (result.error) {
        // Retry automatically. Local data is already safe in localStorage.
        console.error('Supabase save failed for ' + key + ':', result.error);
        signal('supabase-save-error', { key: key, error: result.error });
        pending[key] = value;
        setTimeout(function () { flush(key); }, 1000);
      } else {
        signal('supabase-saved', { key: key });
      }
    }).catch(function (err) {
      console.error('Supabase save failed for ' + key + ':', err);
      signal('supabase-save-error', { key: key, error: err });
      pending[key] = value;
      setTimeout(function () { flush(key); }, 1000);
    });
  }

  function flushAll() {
    return Promise.all(Object.keys(pending).map(flush));
  }

  function deleteAllTenantData(){
    var prefix = tenantStoragePrefix();
    Object.keys(pending).forEach(function (key) {
      if (!prefix || scopedKey(key).indexOf(prefix) === 0) {
        delete pending[key];
        if (timers[key]) { clearTimeout(timers[key]); timers[key] = null; }
      }
    });

    applyingRemote = true;
    try {
      Object.keys(localStorage).forEach(function (key) {
        var isTenantDataKey = prefix ? key.indexOf(prefix) === 0 : isDataKey(key);
        if (isTenantDataKey) originalRemove.call(localStorage, key);
      });
    } finally {
      applyingRemote = false;
    }

    if (!client) return Promise.resolve();
    return flushAll().then(function () {
      var query = client.from('eventalk_content').delete();
      query = prefix ? query.like('key', prefix + '%') : query.not('key', 'like', 'tenant_%');
      return query.then(function (result) {
        if (result.error) throw result.error;
        signal('supabase-deleted', { tenantId: tenantId() });
      });
    });
  }

  function localKeyFromRemoteKey(key) {
    var remoteKey = String(key || '');
    if (tenantId() === 'default') return remoteKey;
    var prefix = 'tenant_' + tenantId().replace(/[^a-zA-Z0-9_-]/g, '_') + '__';
    return remoteKey.indexOf(prefix) === 0 ? remoteKey.slice(prefix.length) : null;
  }

  function applyRemoteChange(payload) {
    var remoteKey = payload && payload.new && payload.new.key || payload && payload.old && payload.old.key;
    var localKey = localKeyFromRemoteKey(remoteKey);
    if (!localKey || !isDataKey(localKey)) return;

    var isDelete = payload.eventType === 'DELETE';
    applyingRemote = true;
    try {
      if (isDelete) originalRemove.call(localStorage, scopedKey(localKey));
      else if (payload.new && payload.new.data !== undefined) originalSet.call(localStorage, scopedKey(localKey), JSON.stringify(payload.new.data));
    } finally {
      applyingRemote = false;
    }
    delete pending[localKey];
    if (timers[localKey]) { clearTimeout(timers[localKey]); timers[localKey] = null; }
    signal('localstorage-remote-change', { key: localKey, deleted: isDelete });
  }

  function subscribeToChanges() {
    if (!client || !client.channel) return;
    realtimeChannel = client.channel('eventalk-content-sync-' + tenantId());
    realtimeChannel.on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'eventalk_content'
    }, applyRemoteChange).subscribe(function(status) {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('Supabase realtime unavailable:', status);
      }
    });
  }

  function hydrate() {
    if (!client) {
      hydrating = false;
      window._localstorageHydrated = true;
      signal('localstorage-hydrated', { remoteChanged: false });
      return;
    }

    client.from('eventalk_content')
      .select('key,data,updated_at')
      .then(function (result) {
        if (result.error) throw result.error;

        var rows = result.data || [];
        var remoteKeys = Object.create(null);
        var remoteChanged = false;

        rows.forEach(function (row) {
          var prefix = 'tenant_' + tenantId().replace(/[^a-zA-Z0-9_-]/g, '_') + '__';
          var localKey = tenantId() === 'default' ? String(row.key) : String(row.key).slice(prefix.length);
          if (tenantId() !== 'default' && String(row.key).indexOf(prefix) !== 0) return;
          if (!isDataKey(localKey)) return;
          remoteKeys[localKey] = true;

          var local = originalGet.call(localStorage, scopedKey(localKey));
          var hadPreHydrationWrite = Object.prototype.hasOwnProperty.call(preHydrationWrites, localKey);

          // Supabase is authoritative for keys that already exist remotely.
          // This fixes stale localStorage after another device/browser updates data.
          if (!hadPreHydrationWrite && local !== null && !sameData(parse(local), row.data)) {
            applyingRemote = true;
            try { originalSet.call(localStorage, scopedKey(localKey), JSON.stringify(row.data)); }
            finally { applyingRemote = false; }
            remoteChanged = true;
          } else if (local === null) {
            applyingRemote = true;
            try { originalSet.call(localStorage, scopedKey(localKey), JSON.stringify(row.data)); }
            finally { applyingRemote = false; }
            remoteChanged = true;
          } else if (hadPreHydrationWrite && !sameData(parse(local), row.data)) {
            // A page may write default data while loading. Keep the database value
            // instead of accidentally overwriting real remote data with defaults.
            applyingRemote = true;
            try { originalSet.call(localStorage, scopedKey(localKey), JSON.stringify(row.data)); }
            finally { applyingRemote = false; }
            remoteChanged = true;
          }
        });

        // If a key exists only locally, save it once. This supports first-time setup.
        Object.keys(preHydrationWrites).forEach(function (key) {
          if (!remoteKeys[key]) queueSave(key, originalGet.call(localStorage, scopedKey(key)), true);
        });

        preHydrationWrites = Object.create(null);
        hydrating = false;
        window._localstorageHydrated = true;
        signal('localstorage-hydrated', { remoteChanged: remoteChanged });

        // Existing pages read localStorage during startup and do not all listen for
        // custom events. If remote data replaced stale/default local data, reload once
        // for this page so its existing render code sees the correct values.
        if (remoteChanged) {
          var reloadKey = 'eventalk_hydration_reload_' + location.pathname;
          if (!sessionStorage.getItem(reloadKey)) {
            sessionStorage.setItem(reloadKey, '1');
            setTimeout(function () { location.reload(); }, 20);
          }
        }
      })
      .catch(function (err) {
        console.error('Supabase load failed:', err);
        // Never block the website when Supabase is temporarily unavailable.
        Object.keys(preHydrationWrites).forEach(function (key) {
          queueSave(key, originalGet.call(localStorage, scopedKey(key)), true);
        });
        preHydrationWrites = Object.create(null);
        hydrating = false;
        window._localstorageHydrated = true;
        signal('localstorage-hydrated', { remoteChanged: false, error: err });
      });
  }

  function startSync() {
    if (started) return;
    started = true;

    if (!window.supabase || !window.SUPABASE_URL || !window.SUPABASE_ANON_KEY ||
        String(window.SUPABASE_URL).indexOf('YOUR_') === 0 ||
        String(window.SUPABASE_ANON_KEY).indexOf('YOUR_') === 0) {
      console.warn('Supabase is not configured. The app will use localStorage only.');
      hydrating = false;
      window._localstorageHydrated = true;
      signal('localstorage-hydrated', { remoteChanged: false });
      return;
    }

    client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    window.eventalkSupabase = client;
    window.eventalkSupabaseReady = true;

    subscribeToChanges();
    hydrate();
  }

  Storage.prototype.setItem = function (key, value) {
    var actualKey = this === localStorage && isDataKey(key) ? scopedKey(key) : key;
    originalSet.call(this, actualKey, value); // instant local save

    if (this !== localStorage || !isDataKey(key) || applyingRemote) return;

    if (hydrating) {
      preHydrationWrites[String(key)] = true;
      return;
    }

    queueSave(String(key), value, false);
  };

  Storage.prototype.getItem = function (key) {
    var actualKey = this === localStorage && isDataKey(key) ? scopedKey(key) : key;
    return originalGet.call(this, actualKey);
  };

  Storage.prototype.removeItem = function (key) {
    var actualKey = this === localStorage && isDataKey(key) ? scopedKey(key) : key;
    originalRemove.call(this, actualKey); // instant local delete
    if (this !== localStorage || !isDataKey(key) || applyingRemote || !client) return;

    if (hydrating) {
      preHydrationWrites[String(key)] = true;
      return;
    }

    client.from('eventalk_content').delete().eq('key', scopedKey(key)).then(function (result) {
      if (result.error) {
        console.error('Supabase delete failed for ' + key + ':', result.error);
        signal('supabase-save-error', { key: key, error: result.error });
      }
    });
  };

  Storage.prototype.clear = function () {
    // Keep clear() local. The app does not use clear() for database operations.
    originalClear.call(this);
  };

  window.eventalkFlushSupabase = flushAll;
  window.eventalkDeleteAllTenantData = deleteAllTenantData;
  window.addEventListener('pagehide', flushAll);
  window.addEventListener('beforeunload', flushAll);

  // Start as soon as Supabase CDN/config are available.
  if (window.supabase) startSync();
  else window.addEventListener('supabase-ready', startSync, { once: true });
})();
