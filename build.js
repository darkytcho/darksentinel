const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const SRC = path.join(__dirname, 'src', 'Dark Sentinel.user.js');
const CONFIG = path.join(__dirname, 'obfuscator.config.json');
const OUT_OBFUSCATED = path.join(__dirname, 'dist', 'sentinel.js');
const OUT_LOADER = path.join(__dirname, 'dist', 'DarkSentinel.obs.user.js');
const TEMP_LOADER = path.join(__dirname, 'dist', '_loader_temp.js');

const GITHUB_RAW = 'https://raw.githubusercontent.com/darkytcho/darksentinel/main/dist/sentinel.js';

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
	var u = '${GITHUB_RAW}?' + Date.now();

	if (location.protocol !== 'https:') {
		console.error('[Dark Sentinel] Abortado: conexao nao e HTTPS.');
		return;
	}

	fetch(u)
		.then(function (r) {
			if (!r.ok) throw new Error('HTTP ' + r.status);
			return r.text();
		})
		.then(function (c) {
			return crypto.subtle.digest('SHA-256', new TextEncoder().encode(c))
				.then(function (buf) {
					var computed = Array.from(new Uint8Array(buf))
						.map(function (b) { return b.toString(16).padStart(2, '0'); })
						.join('');
					return { code: c, hash: computed };
				});
		})
		.then(function (result) {
			if (result.hash !== EXPECTED_HASH) {
				console.error('[Dark Sentinel] ERRO: Hash SHA-256 nao confere!');
				console.error('[Dark Sentinel] Esperado:', EXPECTED_HASH);
				console.error('[Dark Sentinel] Recebido:', result.hash);
				console.error('[Dark Sentinel] O codigo pode ter sido adulterado. Atualizacao bloqueada.');
				return;
			}
			var s = document.createElement('script');
			s.textContent = result.code;
			document.head.appendChild(s);
			s.remove();
		})
		.catch(function (e) {
			console.error('[Dark Sentinel] Falha ao carregar:', e.message);
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
// @grant        none
// ==/UserScript==
`;

fs.writeFileSync(OUT_LOADER, metadata + obfuscatedLoader, 'utf8');
console.log('[build] Loader obfuscado gerado:', OUT_LOADER);
console.log('[build] Build concluido com sucesso!');
