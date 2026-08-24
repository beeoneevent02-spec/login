(function () {
  'use strict';

  function isPremiumAccount() {
    try {
      var session = JSON.parse(sessionStorage.getItem('eventalk_admin_session') || 'null');
      return !!session && session.accountType === 'premium';
    } catch (e) { return false; }
  }

  function tenantId() {
    try {
      var session = JSON.parse(sessionStorage.getItem('eventalk_admin_session') || '{}');
      if (session.tenantId) return String(session.tenantId);
    } catch (e) {}
    return new URLSearchParams(window.location.search).get('tenant') || '';
  }

  function shareConfig() {
    var button = document.querySelector('[data-student-share]');
    var competition = button && button.dataset.studentShare === 'competition';
    return {
      competition: competition,
      target: competition ? 'student-competition.html' : 'student-registration.html',
      key: competition ? 'student_competition_link_available' : 'student_registration_link_available',
      title: competition ? 'Share Student Competition' : 'Share Student Registration',
      description: competition ? 'Send this link to students so they can add themselves to a competition.' : 'Send this link to students so they can register themselves.',
      permission: competition ? 'Allow students to add competition entries' : 'Allow opening the registration link'
    };
  }

  function registrationLink() {
    var config = shareConfig();
    var link = new URL(config.target, window.location.href);
    var tenant = tenantId();
    if (tenant && tenant !== 'default') link.searchParams.set('tenant', tenant);
    link.searchParams.set('shared', '1');
    return link.href;
  }

  function setLinkAvailability(available) {
    localStorage.setItem(availabilityKey(), available ? 'true' : 'false');
  }

  function availabilityKey() {
    var tenant = tenantId();
    if (!tenant || tenant === 'default') return shareConfig().key;
    return 'tenant_' + tenant.replace(/[^a-zA-Z0-9_-]/g, '_') + '__' + shareConfig().key;
  }

  function linkIsAvailable() {
    return localStorage.getItem(availabilityKey()) === 'true';
  }

  function copyLink() {
    var link = registrationLink();
    var copy = navigator.clipboard && navigator.clipboard.writeText
      ? navigator.clipboard.writeText(link)
      : Promise.reject(new Error('Clipboard unavailable'));
    copy.then(function () { alert('Student registration link copied.'); }).catch(function () {
      window.prompt('Copy this student registration link:', link);
    });
  }

  function openLink() {
    if (!isPremiumAccount()) return;
    var allowOpen = document.getElementById('student-share-allow-open');
    if (!allowOpen || !allowOpen.checked) return;
    window.open(registrationLink(), '_blank', 'noopener');
  }

  function openShare() {
    if (!isPremiumAccount()) return;
    var modal = document.getElementById('studentShareModal');
    if (!modal) return;
    document.getElementById('student-share-link').value = registrationLink();
    var allowOpen = document.getElementById('student-share-allow-open');
    var open = document.getElementById('student-share-open');
    if (allowOpen) allowOpen.checked = linkIsAvailable();
    if (open) open.disabled = !linkIsAvailable();
    modal.hidden = false;
  }

  function closeShare() {
    var modal = document.getElementById('studentShareModal');
    if (modal) modal.hidden = true;
  }

  function createModal() {
    if (!document.querySelector('[data-student-share]') || !isPremiumAccount()) return;
    document.body.insertAdjacentHTML('beforeend', '<div id="studentShareModal" hidden style="position:fixed;inset:0;z-index:1060;background:rgba(0,0,0,.7);padding:20px;overflow:auto;"><section role="dialog" aria-modal="true" aria-labelledby="studentShareTitle" style="max-width:560px;margin:10vh auto;background:#101b3d;color:#fff;padding:24px;border-radius:8px;border:1px solid #2b3d70;"><div style="display:flex;justify-content:space-between;align-items:center;"><h5 id="studentShareTitle" style="color:#fff;margin:0;">Share Student Registration</h5><button type="button" id="student-share-close" aria-label="Close" style="background:none;border:0;color:#fff;font-size:24px;">&times;</button></div><p style="margin-top:16px;">Send this link to students so they can register themselves.</p><div style="display:flex;gap:8px;flex-wrap:wrap;"><input id="student-share-link" class="form-control" readonly><button type="button" id="student-share-copy" class="btn btn-info">Copy Link</button><button type="button" id="student-share-open" class="btn btn-success" disabled>Open Link</button></div><label for="student-share-allow-open" style="display:block;margin-top:12px;"><input type="checkbox" id="student-share-allow-open"> Allow opening the registration link</label><div style="text-align:right;margin-top:16px;"><button type="button" id="student-share-close-footer" class="btn btn-secondary">Close</button></div></section></div>');
    var config = shareConfig();
    document.getElementById('studentShareTitle').textContent = config.title;
    document.querySelector('#studentShareModal p').textContent = config.description;
    var allowOpen = document.getElementById('student-share-allow-open');
    allowOpen.checked = linkIsAvailable();
    document.getElementById('student-share-open').disabled = !allowOpen.checked;
    allowOpen.parentNode.lastChild.textContent = ' ' + config.permission;
  }

  function bind() {
    if (!isPremiumAccount()) {
      document.querySelectorAll('[data-student-share]').forEach(function (button) { button.closest('li') ? button.closest('li').remove() : button.remove(); });
      return;
    }
    document.querySelectorAll('[data-student-share]').forEach(function (button) { button.addEventListener('click', openShare); });
    var close = document.getElementById('student-share-close');
    if (close) close.addEventListener('click', closeShare);
    var footerClose = document.getElementById('student-share-close-footer');
    if (footerClose) footerClose.addEventListener('click', closeShare);
    var modal = document.getElementById('studentShareModal');
    if (modal) modal.addEventListener('click', function (event) { if (event.target === modal) closeShare(); });
    var copy = document.getElementById('student-share-copy');
    if (copy) copy.addEventListener('click', copyLink);
    var open = document.getElementById('student-share-open');
    if (open) open.addEventListener('click', openLink);
    var allowOpen = document.getElementById('student-share-allow-open');
    if (allowOpen && open) allowOpen.addEventListener('change', function () {
      open.disabled = !allowOpen.checked;
      setLinkAvailability(allowOpen.checked);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { createModal(); bind(); });
  else { createModal(); bind(); }
})();
