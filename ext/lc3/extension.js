/* Boot the LC3 extension.
 *
 * The extension is written in LiveScript, in extension.ls. VS Code loads a web
 * extension as JavaScript from a URL, so this file fetches the compiler and the
 * source, compiles them here, and hands back the activate() that comes out.
 * The requests are synchronous because activate() may be called the moment this
 * file finishes, and there is nothing else for this worker to do meanwhile.
 */
'use strict';

const vscode = require('vscode');

function get(url) {
  const x = new XMLHttpRequest();
  x.open('GET', url, false);
  x.send(null);
  if (x.status !== 200 && x.status !== 0) {
    throw new Error('cannot load ' + url + ' (' + x.status + ')');
  }
  return x.responseText;
}

const origin = (typeof self !== 'undefined' && self.location) ? self.location.origin : '';
// Indirect eval puts the compiler in the worker's own scope, where the compiled
// extension can see it; the extension itself gets `vscode` and `module` passed
// in rather than reaching for a require() that a browser does not have.
(0, eval)(get(origin + '/runtime/livescript.js'));
const compiled = self.LiveScript.compile(get(origin + '/ide-ext/lc3/extension.ls'), { bare: true });
new Function('vscode', 'module', 'exports', compiled)(vscode, module, module.exports);
