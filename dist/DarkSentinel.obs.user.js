// ==UserScript==
// @name         Dark Sentinel
// @version      1.6.2
// @author       Dark Rebel
// @description  Sentinelas automatizadas para Grepolis
// @updateURL    https://github.com/darkytcho/darksentinel/releases/latest/download/DarkSentinel.obs.user.js
// @downloadURL  https://github.com/darkytcho/darksentinel/releases/latest/download/DarkSentinel.obs.user.js
// @include      http://*.grepolis.com/game/*
// @include      https://*.grepolis.com/game/*
// @grant        none
// ==/UserScript==

(function () {
	'use strict';
	var EXPECTED_HASH = 'd7b08d18c19edf5b73cb91e18b78d4553938e6786a367f660e3ca5610f3a65ba';
	var u = 'https://raw.githubusercontent.com/darkytcho/darksentinel/main/dist/sentinel.js?' + Date.now();

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
