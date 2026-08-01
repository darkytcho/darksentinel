const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const SRC = path.join(__dirname, 'src', 'Dark Sentinel.user.js');
const CONFIG = path.join(__dirname, 'obfuscator.config.json');
const OUT_OBFUSCATED = path.join(__dirname, 'dist', 'sentinel.js');
const OUT_LOADER = path.join(__dirname, 'dist', 'DarkSentinel.obs.user.js');
const TEMP_LOADER = path.join(__dirname, 'dist', '_loader_temp.js');

const GITHUB_RELEASE = 'https://github.com/darkytcho/darksentinel/releases/download/v' + JSON.parse(require('fs').readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version + '/sentinel.js';

console.log('[build] Lendo source...');
const source = fs.readFileSync(SRC, 'utf8');

console.log('[build] Obfuscando sentinel.js...');
const obfuscatorBin = path.join(__dirname, 'node_modules', '.bin', 'javascript-obfuscator');
execSync(
    `"${obfuscatorBin}" "${SRC}" --config "${CONFIG}" --output "${OUT_OBFUSCATED}"`,
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
);

console.log('[build] Calculando SHA-256...');
const obfuscated = fs.readFileSync(OUT_OBFUSCATED);
const hash = crypto.createHash('sha256').update(obfuscated).digest('hex');
console.log('[build] Hash:', hash);

console.log('[build] Gerando loader...');
const version = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version;

const loaderCode = `(function () {
	'use strict';
	var EXPECTED_HASH = '${hash}';
	var u = '${GITHUB_RELEASE}';
	var win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

	try {
		Object.defineProperty(win, 'GM_setValue', { value: GM_setValue, enumerable: false, configurable: true, writable: false });
		Object.defineProperty(win, 'GM_getValue', { value: GM_getValue, enumerable: false, configurable: true, writable: false });
	} catch (e) {}

	function injetarCodigo(c) {
		var d = win.document;
		var s = d.createElement('script');
		s.textContent = c;
		d.head.appendChild(s);
		s.remove();
	}

	GM_xmlhttpRequest({
		method: 'GET',
		url: u,
		onload: function (resp) {
			if (resp.status !== 200) return;
			var c = resp.responseText;
			crypto.subtle.digest('SHA-256', new TextEncoder().encode(c))
				.then(function (buf) {
					var computed = Array.from(new Uint8Array(buf))
						.map(function (b) { return b.toString(16).padStart(2, '0'); })
						.join('');
					if (computed !== EXPECTED_HASH) return;
					injetarCodigo(c);
				});
		},
		onerror: function () {}
	});
})();
`;

console.log('[build] Obfuscando loader...');
fs.writeFileSync(TEMP_LOADER, loaderCode, 'utf8');
execSync(
    `"${obfuscatorBin}" "${TEMP_LOADER}" --config "${CONFIG}" --output "${TEMP_LOADER}"`,
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
);
const obfuscatedLoader = fs.readFileSync(TEMP_LOADER, 'utf8');
fs.unlinkSync(TEMP_LOADER);

const metadata = `// ==UserScript==
// @name         Dark Sentinel
// @version      ${version}
// @author       Dark Rebel
// @description  Sentinelas automatizadas para Grepolis
// @updateURL    https://github.com/darkytcho/darksentinel/releases/latest/download/DarkSentinel.obs.user.js
// @downloadURL  https://github.com/darkytcho/darksentinel/releases/latest/download/DarkSentinel.obs.user.js
// @include      http://*.grepolis.com/game/*
// @include      https://*.grepolis.com/game/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      github.com
// @connect      release-assets.githubusercontent.com
// @connect      raw.githubusercontent.com
// @connect      gpit.innogamescdn.com
// ==/UserScript==
`;

fs.writeFileSync(OUT_LOADER, metadata + obfuscatedLoader, 'utf8');
console.log('[build] Loader obfuscado gerado:', OUT_LOADER);
console.log('[build] Build concluido com sucesso!');
