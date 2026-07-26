// ==UserScript==
// @name         Dark Sentinel Loader
// @version      1.5
// @author       Dark Rebel
// @description  Loader para Dark Sentinel
// @include      http://*.grepolis.com/game/*
// @include      https://*.grepolis.com/game/*
// @grant        none
// ==/UserScript==

(function () {
	'use strict';
	var url = 'https://raw.githubusercontent.com/darkytcho/darksentinel/main/sentinel.js';
	fetch(url)
		.then(function (r) { return r.text(); })
		.then(function (code) {
			var s = document.createElement('script');
			s.textContent = code;
			document.head.appendChild(s);
			s.remove();
		});
})();
