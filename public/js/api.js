/* api.js · 与本地后端通信 */
'use strict';

(function () {
  function req(method, url, body) {
    var opt = { method: method, headers: {} };
    if (body !== undefined) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    return fetch(url, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) {
          var err = new Error((j && j.error) || ('HTTP ' + r.status));
          err.status = r.status;
          throw err;
        }
        return j;
      });
    });
  }

  window.api = {
    state: function () { return req('GET', '/api/state'); },
    createPerson: function (d) { return req('POST', '/api/persons', d); },
    updatePerson: function (id, d) { return req('PUT', '/api/persons/' + encodeURIComponent(id), d); },
    deletePerson: function (id) { return req('DELETE', '/api/persons/' + encodeURIComponent(id)); },
    createRelation: function (d) { return req('POST', '/api/relations', d); },
    updateRelation: function (id, d) { return req('PUT', '/api/relations/' + encodeURIComponent(id), d); },
    deleteRelation: function (id) { return req('DELETE', '/api/relations/' + encodeURIComponent(id)); },
    createDiary: function (d) { return req('POST', '/api/diaries', d); },
    updateDiary: function (id, d) { return req('PUT', '/api/diaries/' + encodeURIComponent(id), d); },
    deleteDiary: function (id) { return req('DELETE', '/api/diaries/' + encodeURIComponent(id)); },
    saveSettings: function (s) { return req('PUT', '/api/settings', s); },
    context: function () { return req('GET', '/api/context'); },
    chat: function (question, history) { return req('POST', '/api/chat', { question: question, history: history }); },
    importData: function (d) { return req('POST', '/api/import', d); }
  };
})();