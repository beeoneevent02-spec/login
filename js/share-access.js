(function () {
  'use strict';
  var sharedAccessId = '';

  function isPremiumAccount() {
    try {
      var session = JSON.parse(sessionStorage.getItem('eventalk_admin_session') || 'null');
      return !!session && session.accountType === 'premium';
    } catch (e) { return false; }
  }

  function getTenantId() {
    try {
      var session = JSON.parse(sessionStorage.getItem('eventalk_admin_session') || '{}');
      if (session.tenantId) return String(session.tenantId);
    } catch (e) {}
    return new URLSearchParams(window.location.search).get('tenant') || '';
  }

  function getLoginLink() {
    var loginUrl = new URL('shared-login.html', window.location.href);
    loginUrl.searchParams.set('next', window.location.pathname.split('/').pop());
    loginUrl.searchParams.set('shared', '1');
    if (sharedAccessId) loginUrl.searchParams.set('access', sharedAccessId);
    var tenant = getTenantId();
    if (tenant && tenant !== 'default') loginUrl.searchParams.set('tenant', tenant);
    var username = document.getElementById('share-access-username');
    if (username && username.value.trim()) loginUrl.searchParams.set('username', username.value.trim());
    return loginUrl.href;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    var input = document.createElement('textarea');
    input.value = text;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
    return Promise.resolve();
  }

  function openModal() {
    var modal = document.getElementById('shareAccessModal');
    if (!modal) return;
    document.getElementById('share-access-link').value = getLoginLink();
    modal.hidden = false;
    document.getElementById('share-access-username').focus();
  }

  function closeModal() {
    var modal = document.getElementById('shareAccessModal');
    if (modal) modal.hidden = true;
  }

  function downloadDetails() {
    var username = document.getElementById('share-access-username').value.trim();
    var password = document.getElementById('share-access-password').value;
    if (!username || !password) {
      alert('Enter the login username and password first.');
      return;
    }
    var details = 'Beeone Digital shared access\n\nLogin link: ' + getLoginLink() + '\nUsername: ' + username + '\nPassword: ' + password + '\n';
    var url = URL.createObjectURL(new Blob([details], { type: 'text/plain' }));
    var link = document.createElement('a');
    link.href = url;
    link.download = 'beeone-shared-access.txt';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function saveAccess() {
    if (!isPremiumAccount()) return;
    var username = document.getElementById('share-access-username').value.trim();
    var password = document.getElementById('share-access-password').value;
    var available = document.getElementById('share-access-available').checked;
    var page = window.location.pathname.split('/').pop();
    if (!window.adminAuth || !window.adminAuth.createSharedAccess) {
      alert('Shared access is not available.');
      return;
    }
    window.adminAuth.createSharedAccess(username, password, page, available).then(function (result) {
      if (!result.success) { alert(result.error); return; }
      sharedAccessId = result.account.id || '';
      document.getElementById('share-access-link').value = getLoginLink();
      alert('Login access saved to Supabase. You can now copy the link or download the details.');
    });
  }

  function bind() {
    if (!isPremiumAccount()) {
      document.querySelectorAll('[data-share-access]').forEach(function (button) { button.closest('li') ? button.closest('li').remove() : button.remove(); });
      return;
    }
    if (new URLSearchParams(window.location.search).get('shared') === '1') {
      document.querySelectorAll('.nav-item.dropdown').forEach(function (item) { item.remove(); });
      document.querySelectorAll('[data-share-access]').forEach(function (button) { button.remove(); });
      validateOpenedPage();
      setInterval(validateOpenedPage, 5000);
    }
    var sessionUsername = '';
    try {
      var session = JSON.parse(sessionStorage.getItem('eventalk_admin_session') || '{}');
      sessionUsername = session.username || '';
    } catch (e) {}
    document.querySelectorAll('[data-share-access]').forEach(function (button) {
      button.addEventListener('click', openModal);
    });
    var username = document.getElementById('share-access-username');
    if (username) username.value = sessionUsername;
    if (username) username.addEventListener('input', function () {
      document.getElementById('share-access-link').value = getLoginLink();
    });
    var close = document.getElementById('share-access-close');
    if (close) close.addEventListener('click', closeModal);
    var modal = document.getElementById('shareAccessModal');
    if (modal) modal.addEventListener('click', function (event) { if (event.target === modal) closeModal(); });
    var copy = document.getElementById('share-access-copy');
    if (copy) copy.addEventListener('click', function () {
      copyText(document.getElementById('share-access-link').value).then(function () { alert('Login link copied.'); });
    });
    var download = document.getElementById('share-access-download');
    if (download) download.addEventListener('click', downloadDetails);
    var save = document.getElementById('share-access-save');
    if (save) save.addEventListener('click', saveAccess);
  }

  function closeOpenedPage() {
    if (document.getElementById('shared-access-closed')) return;
    var overlay = document.createElement('div');
    overlay.id = 'shared-access-closed';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#080d1c;color:#fff;display:flex;align-items:center;justify-content:center;text-align:center;font:700 42px Arial;';
    overlay.textContent = 'CLOSED';
    document.body.innerHTML = '';
    document.body.appendChild(overlay);
    try { if (window.adminAuth && window.adminAuth.logout) window.adminAuth.logout(); } catch (e) {}
  }

  function validateOpenedPage() {
    if (!window.adminAuth || !window.adminAuth.validateSharedAccess) return;
    window.adminAuth.validateSharedAccess().then(function (valid) { if (!valid) closeOpenedPage(); });
  }

  function createModal() {
    if (!document.querySelector('[data-share-access]') || document.getElementById('shareAccessModal') || !isPremiumAccount()) return;
    document.body.insertAdjacentHTML('beforeend', '<div id="shareAccessModal" hidden style="position:fixed;inset:0;z-index:1060;background:rgba(0,0,0,.7);padding:20px;overflow:auto;"><section role="dialog" aria-modal="true" aria-labelledby="shareAccessTitle" style="max-width:520px;margin:8vh auto;background:#101b3d;color:#fff;padding:24px;border-radius:8px;border:1px solid #2b3d70;"><div style="display:flex;justify-content:space-between;align-items:center;"><h5 id="shareAccessTitle" style="color:#fff;margin:0;">Create Shared Login</h5><button type="button" id="share-access-close" aria-label="Close" style="background:none;border:0;color:#fff;font-size:24px;">&times;</button></div><p style="margin-top:16px;">Save a separate login for this page in Supabase.</p><label for="share-access-link">Login link</label><div style="display:flex;gap:8px;margin-bottom:12px;"><input id="share-access-link" class="form-control" readonly><button type="button" id="share-access-copy" class="btn btn-info">Copy Link</button></div><label for="share-access-username">New login username</label><input id="share-access-username" class="form-control mb-2"><label for="share-access-password">New login password</label><input id="share-access-password" type="password" class="form-control mb-2"><label style="display:flex;align-items:center;gap:8px;margin-bottom:16px;"><input id="share-access-available" type="checkbox" checked> Available - allow this link to open</label><div style="display:flex;gap:8px;justify-content:flex-end;"><button type="button" id="share-access-save" class="btn btn-primary">Save Login</button><button type="button" id="share-access-download" class="btn btn-success">Download Details</button><button type="button" id="share-access-close-footer" class="btn btn-secondary">Close</button></div></section></div>');
    document.getElementById('share-access-close-footer').addEventListener('click', closeModal);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { createModal(); bind(); });
  else { createModal(); bind(); }
})();
