(function(){
  var STORAGE_KEY = 'eventalk_admin_authenticated';
  var SESSION_KEY = 'eventalk_admin_session';
  var USERS_KEY = 'eventalk_admin_users';
  var SUPER_ADMIN_USERNAME = 'RASHID313';
  var SUPER_ADMIN_PASSWORD = '662830';
  var SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  var sessionTimeoutId = null;

  function isAuthenticated(){
    return sessionStorage.getItem(STORAGE_KEY) === 'true';
  }

  function getSession(){
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); }
    catch (e) { return null; }
  }

  function hasFeatureAccess(feature){
    var session = getSession();
    if(!session || session.accountType === 'free') return false;
    if(session.sharedAccess) return session.sharedPage === feature + '.html';
    return feature === 'green-room' || feature === 'judge-mark-entry';
  }

  function setSession(session){
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    sessionStorage.setItem(STORAGE_KEY, 'true');
  }

  function normalizeUsername(username){
    return String(username || '').trim().toLowerCase();
  }

  function normalizeAccountType(accountType){
    return accountType === 'premium' || accountType === 'standard' ? accountType : 'free';
  }

  function hashPassword(password){
    if(window.crypto && window.crypto.subtle){
      return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(password)).then(function(buffer){
        return Array.from(new Uint8Array(buffer)).map(function(byte){ return byte.toString(16).padStart(2, '0'); }).join('');
      });
    }
    return Promise.resolve('plain:' + password);
  }

  function supabaseClient(){
    return window.eventalkSupabase || (window.supabase && window.SUPABASE_URL && window.SUPABASE_ANON_KEY
      ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY) : null);
  }

  function createSharedAccess(username, password, allowedPage, available){
    username = normalizeUsername(username);
    password = String(password || '');
    if(!username || password.length < 6) return Promise.resolve({ success: false, error: 'Enter a username and a password of at least 6 characters.' });
    if(allowedPage !== 'green-room.html' && allowedPage !== 'judge-mark-entry.html') return Promise.resolve({ success: false, error: 'Invalid shared page.' });
    var session = getSession();
    var tenantId = session && session.tenantId;
    if(!tenantId || tenantId === 'default') return Promise.resolve({ success: false, error: 'A tenant account is required to create shared access.' });
    var client = supabaseClient();
    if(!client) return Promise.resolve({ success: false, error: 'Supabase is not configured.' });
    return hashPassword(password).then(function(passwordHash){
      return client.from('eventalk_shared_access').update({ available: false, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('allowed_page', allowedPage).then(function(disableResult){
        if(disableResult.error) return Promise.reject(disableResult.error);
        return client.from('eventalk_shared_access').upsert({ tenant_id: tenantId, username: username, password_hash: passwordHash, allowed_page: allowedPage, available: available !== false, updated_at: new Date().toISOString() }, { onConflict: 'username' }).select('id,username,allowed_page,available,updated_at').single();
      }).then(function(result){
        if(result.error) return { success: false, error: result.error.message };
        return { success: true, account: result.data };
      });
    }).catch(function(error){ return { success: false, error: error.message || 'Could not save shared access.' }; });
  }

  function resetSessionTimeout(){
    if(!isAuthenticated()) return;
    if(sessionTimeoutId) clearTimeout(sessionTimeoutId);
    sessionTimeoutId = setTimeout(function(){
      logout();
      if(window.location.pathname.includes('admin') || window.location.pathname.includes('login') === false){
        alert('Your session has expired due to inactivity. Please login again.');
        window.location.href = 'login.html';
      }
    }, SESSION_TIMEOUT_MS);
  }

  function initActivityTracking(){
    if(!isAuthenticated()) return;
    resetSessionTimeout();
    var events = ['click', 'keypress', 'mousemove', 'scroll', 'touchstart'];
    events.forEach(function(event){
      document.addEventListener(event, resetSessionTimeout, true);
    });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', initActivityTracking);
  } else {
    initActivityTracking();
  }

  function getUsers(){
    try {
      var raw = localStorage.getItem(USERS_KEY);
      var users = raw ? JSON.parse(raw) : [];
      return Array.isArray(users) ? users : [];
    } catch (e) {
      return [];
    }
  }

  function saveUsers(users){
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }

  function addUser(username, password){
    if(typeof username !== 'string' || !username.trim()){
      return { success: false, error: 'Username is required.' };
    }
    if(typeof password !== 'string' || !password.trim()){
      return { success: false, error: 'Password is required.' };
    }
    username = username.trim();
    if(username === SUPER_ADMIN_USERNAME){
      return { success: false, error: 'Cannot add the super admin username.' };
    }
    var users = getUsers();
    if(users.some(function(user){ return user.username === username; })){
      return { success: false, error: 'That username already exists.' };
    }
    users.push({ username: username, password: password });
    saveUsers(users);
    return { success: true };
  }

  function deleteUser(username){
    if(username === SUPER_ADMIN_USERNAME){
      return { success: false, error: 'Cannot delete the super admin.' };
    }
    var users = getUsers();
    var remaining = users.filter(function(user){ return user.username !== username; });
    if(remaining.length === users.length){
      return { success: false, error: 'User not found.' };
    }
    saveUsers(remaining);
    return { success: true };
  }

  function login(username, password){
    if(typeof username !== 'string' || typeof password !== 'string'){
      return false;
    }
    username = username.trim();
    if(username.toUpperCase() === SUPER_ADMIN_USERNAME && password === SUPER_ADMIN_PASSWORD){
      setSession({ tenantId: 'default', username: SUPER_ADMIN_USERNAME, name: 'Beeone Digital', place: '', whatsapp: '', accountType: 'premium', superAdmin: true });
      initActivityTracking();
      return true;
    }
    var users = getUsers();
    var match = users.find(function(user){ return user.username === username && user.password === password && user.approved === true; });
    if(match){
      setSession({ tenantId: match.tenantId || 'local-' + normalizeUsername(username), username: match.username, name: match.name || '', place: match.place || '', whatsapp: match.whatsapp || '', accountType: normalizeAccountType(match.accountType) });
      initActivityTracking();
      return true;
    }
    var client = supabaseClient();
    if(!client) return false;
    return hashPassword(password).then(function(passwordHash){
      return client.from('eventalk_tenants').select('id,name,place,whatsapp,username,password_hash,approved,account_type').eq('username', normalizeUsername(username)).maybeSingle().then(function(result){
        if(!result.error && result.data && result.data.password_hash === passwordHash){
          if(result.data.approved !== true) return false;
          client.from('eventalk_tenants').update({ last_login_at: new Date().toISOString() }).eq('id', result.data.id).then(function(){});
          setSession({ tenantId: result.data.id, username: result.data.username, name: result.data.name, place: result.data.place, whatsapp: result.data.whatsapp, accountType: normalizeAccountType(result.data.account_type) });
          initActivityTracking();
          return true;
        }
        var requestedPage = new URLSearchParams(window.location.search).get('next');
        var requestedTenant = new URLSearchParams(window.location.search).get('tenant');
        var accessId = new URLSearchParams(window.location.search).get('access');
        var sharedQuery = client.from('eventalk_shared_access').select('id,tenant_id,username,password_hash,allowed_page,available,updated_at');
        if (accessId) sharedQuery = sharedQuery.eq('id', accessId);
        else sharedQuery = sharedQuery.eq('username', normalizeUsername(username));
        return sharedQuery.maybeSingle().then(function(sharedResult){
          if(sharedResult.error || !sharedResult.data || sharedResult.data.password_hash !== passwordHash) return false;
          if(sharedResult.data.available === false) return false;
          if(requestedTenant && String(sharedResult.data.tenant_id) !== String(requestedTenant)) return false;
          if(requestedPage && sharedResult.data.allowed_page !== requestedPage) return false;
          client.from('eventalk_shared_access').update({ last_login_at: new Date().toISOString() }).eq('username', sharedResult.data.username).then(function(){});
          setSession({ tenantId: sharedResult.data.tenant_id, username: sharedResult.data.username, name: 'Shared Access', place: '', whatsapp: '', accountType: 'standard', sharedAccess: true, sharedPage: sharedResult.data.allowed_page, sharedAccessId: sharedResult.data.id, sharedAccessUpdatedAt: sharedResult.data.updated_at });
          initActivityTracking();
          return true;
        });
      });
    }).catch(function(){ return false; });
  }

  function register(details){
    details = details || {};
    var username = normalizeUsername(details.username);
    var name = String(details.name || '').trim();
    var place = String(details.place || '').trim();
    var whatsapp = String(details.whatsapp || '').trim();
    var accountType = normalizeAccountType(details.accountType);
    var password = String(details.password || '');
    if(!name || !place || !whatsapp || !username || !password) return Promise.resolve({ success: false, error: 'All registration fields are required.' });
    if(username === normalizeUsername(SUPER_ADMIN_USERNAME)) return Promise.resolve({ success: false, error: 'That username is reserved.' });
    return hashPassword(password).then(function(passwordHash){
      var client = supabaseClient();
      if(client){
        return client.from('eventalk_tenants').insert({ name: name, place: place, whatsapp: whatsapp, username: username, password_hash: passwordHash, account_type: accountType, approved: false }).select('id,name,place,whatsapp,username,account_type,approved').single().then(function(result){
          if(result.error) return { success: false, error: result.error.code === '23505' ? 'That username already exists.' : result.error.message };
          var account = result.data;
          var users = getUsers();
          users.push({ username: username, password: password, tenantId: account.id, name: name, place: place, whatsapp: whatsapp, accountType: accountType, approved: false });
          saveUsers(users);
          return { success: true, account: account };
        });
      }
      var users = getUsers();
      if(users.some(function(user){ return normalizeUsername(user.username) === username; })) return { success: false, error: 'That username already exists.' };
      var account = { id: 'local-' + username, name: name, place: place, whatsapp: whatsapp, username: username, account_type: accountType };
      users.push({ username: username, password: password, tenantId: account.id, name: name, place: place, whatsapp: whatsapp, accountType: accountType, approved: false });
      saveUsers(users);
      return { success: true, account: account };
    }).catch(function(error){ return { success: false, error: error.message || 'Registration failed.' }; });
  }

  function logout(){
    if(sessionTimeoutId) clearTimeout(sessionTimeoutId);
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SESSION_KEY);
  }

  function getSuperAdmin(){
    return { username: SUPER_ADMIN_USERNAME, password: SUPER_ADMIN_PASSWORD };
  }

  window.adminAuth = {
    isAuthenticated: isAuthenticated,
    getSession: getSession,
    hasFeatureAccess: hasFeatureAccess,
    getUsers: getUsers,
    addUser: addUser,
    deleteUser: deleteUser,
    login: login,
    register: register,
    logout: logout,
    getSuperAdmin: getSuperAdmin,
    createSharedAccess: createSharedAccess
    ,validateSharedAccess: function(){
      var session = getSession();
      if(!session || !session.sharedAccess || !session.sharedAccessId) return Promise.resolve(true);
      var client = supabaseClient();
      if(!client) return Promise.resolve(false);
      return client.from('eventalk_shared_access').select('tenant_id,available,allowed_page,updated_at').eq('id', session.sharedAccessId).maybeSingle().then(function(result){
        return !result.error && result.data && result.data.available !== false && String(result.data.tenant_id) === String(session.tenantId) && result.data.allowed_page === session.sharedPage && String(result.data.updated_at) === String(session.sharedAccessUpdatedAt);
      }).catch(function(){ return false; });
    }
  };
})();
