// ==UserScript==
// @name         Dark Sentinel
// @version      1.6
// @author       Dark Rebel
// @description  Sentinelas automatizadas para Grepolis
// @updateURL    https://github.com/darkytcho/darksentinel/releases/latest/download/Dark%20Sentinel.obs.user.js
// @downloadURL  https://github.com/darkytcho/darksentinel/releases/latest/download/Dark%20Sentinel.obs.user.js
// @include      http://*.grepolis.com/game/*
// @include      https://*.grepolis.com/game/*
// @grant        none
// ==/UserScript==

(function () {
	'use strict';
	var u = 'https://raw.githubusercontent.com/darkytcho/darksentinel/main/dist/sentinel.js?' + Date.now();
	fetch(u)
		.then(function (r) { return r.text(); })
		.then(function (c) {
			var s = document.createElement('script');
			s.textContent = c;
			document.head.appendChild(s);
			s.remove();
		});
})();
