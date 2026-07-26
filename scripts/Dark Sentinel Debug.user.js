// ==UserScript==
// @name         Dark Sentinel - Debug
// @version      0.1
// @author       Dark Rebel
// @description  Painel de debug para o Dark Sentinel (opcional)
// @include      http://*.grepolis.com/game/*
// @include      https://*.grepolis.com/game/*
// ==/UserScript==

(function () {
	'use strict';

	const CHAVE_LISTA_NEGRA = '\x6c\x6e';
	let painel = null;
	let logs = [];
	let visivel = false;

	function adicionarLog(msg) {
		var d = new Date();
		var h = String(d.getHours()).padStart(2, '0');
		var m = String(d.getMinutes()).padStart(2, '0');
		var s = String(d.getSeconds()).padStart(2, '0');
		logs.push(h + ':' + m + ':' + s + ' - ' + msg);
		if (painel) atualizarConteudo();
	}

	function criarPainel() {
		if (document.getElementById('ds_debug_panel')) return;
		painel = document.createElement('div');
		painel.id = 'ds_debug_panel';
		painel.style.cssText = 'position:fixed;top:60px;right:10px;width:480px;max-height:520px;background:rgba(0,0,0,0.92);color:#0f0;font-family:monospace;font-size:11px;z-index:99999;border:1px solid #555;border-radius:6px;overflow:hidden;display:none;box-shadow:0 4px 20px rgba(0,0,0,0.6);';
		painel.innerHTML =
			'<div style="padding:6px 10px;background:#222;border-bottom:1px solid #444;font-weight:bold;font-size:12px;color:#fff;display:flex;justify-content:space-between;align-items:center;">' +
			'<span>Dark Sentinel - Debug</span>' +
			'<div>' +
			'<span id="ds_debug_limpar_negra" style="cursor:pointer;margin-right:8px;font-size:11px;color:#f39c12;">Limpar Lista Negra</span>' +
			'<span id="ds_debug_listar_negra" style="cursor:pointer;margin-right:8px;font-size:11px;color:#3498db;">Listar Lista Negra</span>' +
			'<span id="ds_debug_clear" style="cursor:pointer;margin-right:8px;font-size:11px;color:#e74c3c;">Limpar</span>' +
			'<span id="ds_debug_close" style="cursor:pointer;font-size:14px;color:#aaa;">&times;</span>' +
			'</div></div>' +
			'<div id="ds_debug_content" style="padding:6px;overflow-y:auto;max-height:460px;word-break:break-all;"></div>';
		document.body.appendChild(painel);

		document.getElementById('ds_debug_close').onclick = function () { painel.style.display = 'none'; visivel = false; };
		document.getElementById('ds_debug_clear').onclick = function () { logs = []; atualizarConteudo(); };
		document.getElementById('ds_debug_limpar_negra').onclick = function () {
			localStorage.removeItem(CHAVE_LISTA_NEGRA);
			adicionarLog('Lista negra limpa!');
		};
		document.getElementById('ds_debug_listar_negra').onclick = function () {
			try {
				var dados = JSON.parse(localStorage.getItem(CHAVE_LISTA_NEGRA) || '{}');
				var agora = Date.now();
				var keys = Object.keys(dados);
				if (keys.length === 0) {
					adicionarLog('Lista negra vazia');
				} else {
					adicionarLog('--- Lista Negra (' + keys.length + ' cidades) ---');
					for (var i = 0; i < keys.length; i++) {
						var resto = Math.round((dados[keys[i]] - agora) / 60000);
						if (resto > 0) adicionarLog('  ID ' + keys[i] + ' - expira em ' + resto + 'min');
					}
				}
			} catch (e) {
				adicionarLog('Erro ao ler lista negra');
			}
		};
	}

	function atualizarConteudo() {
		var content = document.getElementById('ds_debug_content');
		if (!content) return;
		content.innerHTML = logs.map(function (l) { return '<div>' + l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>'; }).join('');
		content.scrollTop = content.scrollHeight;
	}

	function toggle() {
		criarPainel();
		if (painel.style.display === 'none' || !painel.style.display) {
			painel.style.display = 'block';
			visivel = true;
			atualizarConteudo();
		} else {
			painel.style.display = 'none';
			visivel = false;
		}
	}

	window.addEventListener('load', function () {
		setTimeout(function () {
			var btn = document.createElement('div');
			btn.id = 'ds_debug_toggle';
			btn.textContent = 'Debug';
			btn.style.cssText = 'position:fixed;top:35px;right:10px;background:#333;color:#0f0;padding:4px 10px;border-radius:4px;cursor:pointer;font-family:Arial,sans-serif;font-size:11px;z-index:99999;border:1px solid #555;user-select:none;';
			btn.onmouseover = function () { btn.style.background = '#444'; };
			btn.onmouseout = function () { btn.style.background = '#333'; };
			btn.onclick = toggle;
			document.body.appendChild(btn);
		}, 500);
	});

	$(document).ajaxComplete(function (event, xhr, settings) {
		if (settings.url && settings.url.indexOf('send_units') !== -1) {
			try {
				var resp = JSON.parse(xhr.responseText);
				var texto = JSON.stringify(resp);
				if (texto.length > 500) texto = texto.substring(0, 500) + '...';
				adicionarLog('send_units -> ' + texto);
			} catch (e) {
				adicionarLog('send_units (texto): ' + (xhr.responseText || '').substring(0, 200));
			}
		}
	});
})();
