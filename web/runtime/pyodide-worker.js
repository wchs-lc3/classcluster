/* Boot the Python worker.
 *
 * The worker itself is written in LiveScript, in pyodide-worker.ls. A Worker
 * URL has to be JavaScript, so this file fetches the compiler and the source
 * and runs what comes out. Both requests are synchronous on purpose:
 * everything has to be in place before the first message arrives, and this
 * thread has nothing else to do until then.
 */
'use strict';

importScripts('/runtime/livescript.js');

(function () {
  function get(url) {
    const x = new XMLHttpRequest();
    x.open('GET', url, false);
    x.send(null);
    if (x.status !== 200 && x.status !== 0) {
      throw new Error('cannot load ' + url + ' (' + x.status + ')');
    }
    return x.responseText;
  }
  // Indirect eval, so what the source sees as its scope is the worker itself.
  (0, eval)(LiveScript.compile(get('/runtime/pyodide-worker.ls'), { bare: true }));
})();
