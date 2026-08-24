(function () {
  'use strict';

  function getKeys(element) {
    return (element.getAttribute('data-transfer-keys') || '').split(',').map(function (key) {
      return key.trim();
    }).filter(Boolean);
  }

  function readData(keys) {
    var data = {};
    keys.forEach(function (key) {
      var value = localStorage.getItem(key);
      if (value !== null) {
        try { data[key] = JSON.parse(value); }
        catch (e) { data[key] = value; }
      }
    });
    return data;
  }

  function downloadData(keys, prefix) {
    var blob = new Blob([JSON.stringify(readData(keys), null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = prefix + '-data-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function importData(file, keys) {
    var reader = new FileReader();
    reader.onload = function (event) {
      try {
        var data = JSON.parse(event.target.result);
        function applyImport() {
          var imported = 0;
          keys.forEach(function (key) {
            if (!Object.prototype.hasOwnProperty.call(data, key)) return;
            var value = typeof data[key] === 'string' ? data[key] : JSON.stringify(data[key]);
            localStorage.setItem(key, value);
            imported++;
          });
          if (!imported) {
            alert('No matching page data was found in this JSON file.');
            return;
          }
          var syncComplete = window.eventalkFlushSupabase ? window.eventalkFlushSupabase() : Promise.resolve();
          syncComplete.then(function () {
            alert('Imported ' + imported + ' data item(s). The page will reload.');
            window.location.reload();
          });
        }

        if (window._localstorageHydrated) applyImport();
        else window.addEventListener('localstorage-hydrated', applyImport, { once: true });
      } catch (e) {
        alert('Unable to import this file. Please select a valid JSON export.');
      }
    };
    reader.onerror = function () { alert('Unable to read the selected file.'); };
    reader.readAsText(file);
  }

  function bind() {
    document.querySelectorAll('[data-export-data]').forEach(function (button) {
      button.addEventListener('click', function () {
        downloadData(getKeys(button), button.getAttribute('data-export-data') || 'eventalk');
      });
    });
    document.querySelectorAll('[data-import-data]').forEach(function (button) {
      var input = document.querySelector(button.getAttribute('data-import-data'));
      if (!input) return;
      button.addEventListener('click', function () { input.click(); });
      input.addEventListener('change', function () {
        if (input.files && input.files[0]) importData(input.files[0], getKeys(button));
        input.value = '';
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
