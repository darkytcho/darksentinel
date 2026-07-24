// ==UserScript==
// @name         Dark Sentinel
// @version      1.1
// @author       Dark Rebel
// @description  Envio automatizado de sentinelas, botão no contexto e indicador no mapa
// @updateURL    https://raw.githubusercontent.com/darkytcho/darksentinel/main/Dark%20Sentinel.obs.user.js
// @downloadURL  https://raw.githubusercontent.com/darkytcho/darksentinel/main/Dark%20Sentinel.obs.user.js
// @include      http://*.grepolis.com/game/*
// @include      https://*.grepolis.com/game/*
// ==/UserScript==

(function () {
	'use strict';
	const uw = unsafeWindow ? unsafeWindow : window;

	function dsDebug() {}

	// ========================
	// Dados do servidor
	// ========================
	let lista_cidades = [];
	$.ajax({ method: 'get', url: '/data/towns.txt' }).done(function (m) {
		try {
			$.each(m.split(/\r\n|\n/), function (C, J) {
				lista_cidades.push(J.split(/,/));
			});
		} catch (C) {
			console.log(C);
		}
	});

	let lista_jogadores = [];
	$.ajax({ method: 'get', url: '/data/players.txt' }).done(function (m) {
		try {
			$.each(m.split(/\r\n|\n/), function (C, J) {
				lista_jogadores.push(J.split(/,/));
			});
		} catch (C) {
			console.log(C);
		}
	});

	// ========================
	// Funções compartilhadas
	// ========================

	/* Envia sentinela para a cidade alvo. source_id opcional = cidade de origem */
	function enviarSentinela(unit, target_id, source_id) {
		let data = { id: target_id, type: 'support' };
		data[unit] = 1;
		if (source_id) data.town_id = source_id;
		dsDebug('send_units', unit, '->', target_id, 'de', source_id, data);
		uw.gpAjax.ajaxPost('town_info', 'send_units', data);
	}

	/* Retorna a unidade disponível na cidade atual */
	function selecionarUnidade(comCavaleiro, comBigas) {
		let units = uw.ITowns.getCurrentTown().getLandUnits();
		if (units.sword > 0) return 'sword';
		if (units.archer > 0) return 'archer';
		if (units.slinger > 0) return 'slinger';
		if (units.hoplite > 0) return 'hoplite';
		if (comCavaleiro && units.knight > 0) return 'knight';
		if (comBigas && units.chariot > 0) return 'chariot';
		return null;
	}

	/* Verifica se a cidade já tem sentinela (tropas próprias) */
	function temSentinela(id) {
		const towns = Object.keys(uw.ITowns.towns);
		for (let town of towns) {
			if (town == id) return true;
			const models = uw.ITowns.all_supporting_units.fragments[town].models;
			for (let model of models) if (model.attributes.current_town_id == id) return true;
		}
		return false;
	}

	/* Verifica se a cidade tem suporte a caminho */
	function temSuporteACaminho(target_id) {
		let movments = uw.MM.getModels().MovementsUnits;
		for (let m in movments) if (movments[m].attributes.target_town_id == target_id) return true;
		return false;
	}

	/* Verifica se a cidade está na ilha atual */
	function cidadeEstaNaIlha(x, y) {
		const currentTown = uw.ITowns.getCurrentTown();
		const cx = currentTown.getIslandCoordinateX();
		const cy = currentTown.getIslandCoordinateY();
		return cx == x && cy == y;
	}

	// ========================
	// Lista negra (cidades que recusam apoio)
	// ========================

	const CHAVE_LISTA_NEGRA = 'sentinela_lista_negra';
	const DURACAO_LISTA_NEGRA = 24 * 60 * 60 * 1000;

	function obterListaNegra() {
		try {
			return JSON.parse(localStorage.getItem(CHAVE_LISTA_NEGRA) || '{}');
		} catch (e) {
			return {};
		}
	}

	function salvarListaNegra(lista) {
		localStorage.setItem(CHAVE_LISTA_NEGRA, JSON.stringify(lista));
	}

	function estaNaListaNegra(cityId) {
		const lista = obterListaNegra();
		const expiracao = lista[cityId];
		if (!expiracao) return false;
		if (Date.now() > expiracao) {
			delete lista[cityId];
			salvarListaNegra(lista);
			return false;
		}
		return true;
	}

	function adicionarListaNegra(cityId) {
		const lista = obterListaNegra();
		lista[cityId] = Date.now() + DURACAO_LISTA_NEGRA;
		salvarListaNegra(lista);
		console.log('[Dark Sentinel] Cidade ' + cityId + ' adicionada à lista negra (24h)');
	}

	// ========================
	// Botão de Sentinela (menu de contexto)
	// ========================

	function tratarCliqueMenuContexto(target) {
		let unit = selecionarUnidade(false, false);
		if (!unit) {
			uw.HumanMessage.error('Nenhuma tropa disponível');
			return;
		}
		enviarSentinela(unit, target.id);
	}

	uw.$.Observer(uw.GameEvents.map.town.click).subscribe((e, data) => {
		if (!cidadeEstaNaIlha(data.x, data.y)) return;
		if (temSentinela(data.id)) return;
		if (temSuporteACaminho(data.id)) return;
		if (estaNaListaNegra(data.id)) return;
		let menu = uw.$('#context_menu');
		if (!menu) return;
		let div = document.createElement('div');
		div.id = 'sentinel_button';
		div.style.width = '50px';
		div.style.height = '50px';
		div.style.position = 'absolute';
		div.style.background = `url(https://i.ibb.co/9wwBNfD/sentinel.png)`;
		div.style.zIndex = 'auto';
		div.style.cursor = 'pointer';
		div.innerHTML = `
		<div id="sentinel_description" style="position: absolute;overflow: hidden;width: 118px;display: none;margin-left: -59px;left: 50%;top: 40px;z-index: 5;" >
		<div style="position: absolute; top: 0; left: 0; right: 0; background: url(https://gpit.innogamescdn.com/images/game/autogenerated/layout/layout_095495a.png) no-repeat -488px -406px; width: 118px; height: 18px;"></div>
		<div style="position: absolute; top: 18px; left: 0; right: 0; bottom: 11px; background: url(https://gpit.innogamescdn.com/images/game/layout/context_menu_middle.png) repeat-y 0 0;"></div>
		<div style="position: absolute; bottom: 0; left: 0; right: 0; background: url(https://gpit.innogamescdn.com/images/game/autogenerated/layout/layout_095495a.png) no-repeat -326px -240px; width: 118px; height: 11px;"></div>
		<div style="color: #fc6; font-weight: 700; text-align: center; word-wrap: break-word; line-height: 19px; z-index: 1; position: relative; padding: 4px;">Sentinela</div>
		</div>`;
		menu.append(div);
		uw.$('#sentinel_button').animate({ top: '-100px' }, 120);
		uw.$('#sentinel_button').hover(
			() => { uw.$('#sentinel_description').css('display', 'block'); },
			() => { uw.$('#sentinel_description').css('display', 'none'); },
		);
		uw.$('#sentinel_button').click(() => {
			tratarCliqueMenuContexto(data);
			menu.remove();
		});
	});

	// ========================
	// Indicador de Sentinela (escudo verde no mapa)
	// ========================

	let cidadesComSentinela = [];

	function configurarIndicador() {
		const container = document.getElementById('map_move_container');
		const targetNode = document.getElementById('map_islands');
		if (!container || !targetNode) {
			setTimeout(configurarIndicador, 1000);
			return;
		}
		const div = document.createElement('div');
		div.id = 'map_sentinel';
		div.style.position = 'absolute';
		div.style.top = '0px';
		div.style.left = '0px';
		div.style.zIndex = '5';
		div.style.pointerEvents = 'none';
		div.style.opacity = '0.6';
		container.appendChild(div);

		const observerOptions = { childList: true, attributes: true, subtree: true };
		const observer = new MutationObserver(atualizarMapa);
		observer.observe(targetNode, observerOptions);
	}

	function adicionarEscudoVerde(cidadeId) {
		const cidade = document.getElementById(`town_${cidadeId}`);
		if (!cidade) return false;
		const map = document.getElementById('map_sentinel');
		if (!map) return false;
		const x = parseInt(cidade.style.left);
		const y = parseInt(cidade.style.top);
		const shield = document.createElement('div');
		shield.id = `sentinel_shield_${cidadeId}`;
		shield.style.left = `${x - 29}px`;
		shield.style.top = `${y - 25}px`;
		shield.style.background =
			'url(https://gpit.innogamescdn.com/images/game/autogenerated/map/town_overlay/city_shield_cd2b0df.png) no-repeat 0 0';
		shield.style.width = '110px';
		shield.style.height = '72px';
		shield.style.position = 'absolute';
		shield.style.transform = 'translate(10px,10px)';
		shield.style.backgroundSize = '95%';
		shield.style.filter =
			'grayscale(100%) brightness(80%) sepia(300%) hue-rotate(50deg) saturate(500%)';
		map.appendChild(shield);
		return true;
	}

	function removerEscudoVerde(cidadeId) {
		const element = document.getElementById(`sentinel_shield_${cidadeId}`);
		if (!element) return false;
		element.remove();
		return true;
	}

	function atualizarMapa() {
		const towns = Object.keys(uw.ITowns.towns);
		let current = [];
		towns.forEach((e) => {
			const models = uw.ITowns.all_supporting_units.fragments[e].models;
			models.forEach((m) => {
				let attributes = m.attributes;
				current.indexOf(attributes.current_town_id) === -1
					? current.push(attributes.current_town_id)
					: null;
			});
		});

		let removeShield = cidadesComSentinela.filter((x) => !current.includes(x));
		let addShield = current.filter((x) => !cidadesComSentinela.includes(x));
		removeShield.forEach((e) => removerEscudoVerde(e));
		addShield.forEach((e) => {
			if (!adicionarEscudoVerde(e)) current.splice(current.indexOf(e), 1);
		});
		cidadesComSentinela = current;
	}

	// ========================
	// Auto Sentinela (envio em massa na janela da ilha)
	// ========================

	/* Retorna as cidades na ilha (com cache) */
	let cacheCidadesPorIlha = {};
	function obterCidades(islandX, islandY) {
		const chave = islandX + '_' + islandY;
		if (cacheCidadesPorIlha[chave]) return cacheCidadesPorIlha[chave];
		let lista = [];
		for (let i = lista_cidades.length - 1; i >= 0; i--) {
			if (parseInt(lista_cidades[i][3]) == parseInt(islandX) && parseInt(lista_cidades[i][4]) == islandY) {
				lista.push(lista_cidades[i][0]);
			}
		}
		cacheCidadesPorIlha[chave] = lista;
		return lista;
	}

	/* Remove cidades de alianças inimigas */
	function removerAliancas(lista) {
		let aliancaModelos = uw.MM.getCollections().AlliancePact[0];
		if (!aliancaModelos || !aliancaModelos.models.length) return lista;
		let aliancaJogador = aliancaModelos.models[0].attributes.alliance_1_id;
		let aliancasInimigas = new Set();
		for (let i = 0; i < aliancaModelos.models.length; i++) {
			let m = aliancaModelos.models[i].attributes;
			if (m.relation == 'war' && m.alliance_1_id == aliancaJogador) {
				aliancasInimigas.add(String(m.alliance_2_id));
			}
		}
		if (aliancasInimigas.size == 0) return lista;
		let mapaJogador = {};
		for (let i = 0; i < lista_jogadores.length; i++) {
			mapaJogador[lista_jogadores[i][0]] = lista_jogadores[i][2];
		}
		let mapaCidadeJogador = {};
		for (let i = 0; i < lista_cidades.length; i++) {
			mapaCidadeJogador[lista_cidades[i][0]] = lista_cidades[i][1];
		}
		return lista.filter((id) => {
			let jogadorID = mapaCidadeJogador[id];
			if (!jogadorID) return true;
			let aliancaID = mapaJogador[jogadorID];
			if (!aliancaID) return true;
			return !aliancasInimigas.has(String(aliancaID));
		});
	}

	/* Remove cidades que já enviaram sentinela */
	function removerSentinela(lista, type, cidade) {
		let lun = uw.ITowns.all_supporting_units.fragments[cidade].models.length;
		for (let i = 0; i < lun; i++) {
			let sword = uw.ITowns.all_supporting_units.fragments[cidade].models[i].attributes.sword;
			let archer = uw.ITowns.all_supporting_units.fragments[cidade].models[i].attributes.archer;
			if (parseInt(sword) + parseInt(archer) >= type) {
				let id = uw.ITowns.all_supporting_units.fragments[cidade].models[i].attributes.current_town_id;
				lista = lista.filter((item) => item !== String(id));
			}
		}
		return lista;
	}

	/* Remove cidades com suporte a caminho */
	function removerSuporte(lista, cidade) {
		let modelos = uw.MM.getCollections().MovementsUnits[0];
		if (!modelos || !modelos.models.length) return lista;
		let alvos = new Set();
		for (let i = 0; i < modelos.models.length; i++) {
			let m = modelos.models[i].attributes;
			if (m.home_town_id == cidade) alvos.add(String(m.target_town_id));
		}
		if (alvos.size == 0) return lista;
		return lista.filter((id) => !alvos.has(String(id)));
	}

	// ========================
	// Sentinela Global (helpers)
	// ========================

	let cancelarEnvio = false;
	let permitirCavaleiro = false;
	let permitirBigas = false;
	let pendingResolve = null;

	function delay(ms) {
		return new Promise(function (r) { setTimeout(r, ms); });
	}

	function enviarSentinelaPromise(unidade, destinoId, origemId) {
		return new Promise(function (resolve) {
			if (pendingResolve) pendingResolve(null);
			pendingResolve = function (resp) {
				pendingResolve = null;
				resolve(resp);
			};
			enviarSentinela(unidade, destinoId, origemId);
		});
	}

	/* Verifica se uma cidade específica já enviou sentinela para outra */
	function temSentinelaDe(origemId, destinoId) {
		const modelos = uw.ITowns.all_supporting_units.fragments[destinoId];
		if (!modelos) return false;
		for (let model of modelos.models) {
			if (model.attributes.current_town_id == origemId) return true;
		}
		return false;
	}

	/* Retorna a unidade disponível para uma cidade específica */
	function obterUnidadeParaCidade(cidadeId, comCavaleiro, comBigas) {
		const cidade = uw.ITowns.towns[cidadeId];
		if (!cidade) return null;
		const unidades = cidade.getLandUnits();
		if (unidades.sword > 0) return 'sword';
		if (unidades.archer > 0) return 'archer';
		if (unidades.slinger > 0) return 'slinger';
		if (unidades.hoplite > 0) return 'hoplite';
		if (comCavaleiro && unidades.knight > 0) return 'knight';
		if (comBigas && unidades.chariot > 0) return 'chariot';
		return null;
	}

	/* Troca a cidade ativa no jogo */
	function trocarCidadeAtiva(cidadeId) {
		const cidade = uw.ITowns.towns[cidadeId];
		if (!cidade) return false;

		if (typeof uw.ITowns.setCurrentTown === 'function') {
			try { uw.ITowns.setCurrentTown(cidade); return true; } catch (e) {}
			try { uw.ITowns.setCurrentTown(cidadeId); return true; } catch (e) {}
		}

		const metodos = ['setCurrentTown', 'setAsCurrentTown', 'select', 'makeCurrent'];
		for (let i = 0; i < metodos.length; i++) {
			if (typeof cidade[metodos[i]] === 'function') {
				try { cidade[metodos[i]](); return true; } catch (e) {}
			}
		}

		try { uw.gpAjax.ajaxPost('town_overview', 'switch_town', { id: cidadeId }); return true; } catch (e) {}

		const townElement = document.getElementById('town_' + cidadeId);
		if (townElement) { try { townElement.click(); return true; } catch (e) {} }

		return false;
	}

	/* Envia sentinela de uma cidade específica para outra */
	function enviarSentinelaDe(origemId, destinoId, unidade) {
		dsDebug('enviarSentinelaDe origem=' + origemId + ' destino=' + destinoId + ' unidade=' + unidade);
		enviarSentinela(unidade, destinoId, origemId);
		return true;
	}

	/* Retorna as cidades do jogador na ilha */
	function jogadorTemCidades(lista) {
		let lista_retorno = [];
		let cidades_jogador = [];
		for (let i in uw.ITowns.towns) {
			cidades_jogador.push(i);
		}
		for (let i = 0; i < cidades_jogador.length; i++) {
			for (let j = 0; j < lista.length; j++) {
				if (cidades_jogador[i] == lista[j]) {
					lista_retorno.push(cidades_jogador[i]);
				}
			}
		}
		return lista_retorno;
	}

	$(document).ajaxComplete(function () {
		let wnds = GPWindowMgr.getOpen(Layout.wnd.TYPE_ISLAND);
		for (let e in wnds) {
			if (wnds.hasOwnProperty(e)) {
				let wndid = wnds[e].getID();
				let coord = $(`#gpwnd_${wndid}`).find('.islandinfo_coords').text();
				const type = '[0-9][0-9]*/[0-9][0-9]*';
				let coordX = coord.match(type)[0].split('/')[0];
				let coordY = coord.match(type)[0].split('/')[1];
				let wnd_window = document.getElementById(`gpwnd_${wndid}`);

				let sentries_x1 = wnd_window.getElementsByClassName('sentries_x1')[0];
				if (sentries_x1 == null) {
					$($(`#gpwnd_${wndid}`).find('.island_info_wrapper')).append(
						'<div class="button_new sentries_x1"><div class="left"></div><div class="right"></div><div class="caption js-caption"> Enviar Sentinelas <div class="effect js-effect"></div></div></div>'
					);
					$($(`#gpwnd_${wndid}`).find('.island_info_wrapper')).append(
						'<div class="button_new sentries_global" style="margin-left:5px;"><div class="left"></div><div class="right"></div><div class="caption js-caption"> Sentinela Global <div class="effect js-effect"></div></div></div>'
					);
					$($(`#gpwnd_${wndid}`).find('.island_info_wrapper')).append(
						'<div class="checkbox_new sentinela_check_cavaleiro large" style="margin-left:8px;cursor:pointer;"><div class="cbx_icon"></div><div class="cbx_caption">Cavaleiro</div></div>'
					);
					$($(`#gpwnd_${wndid}`).find('.island_info_wrapper')).append(
						'<div class="checkbox_new sentinela_check_bigas large" style="margin-left:8px;cursor:pointer;"><div class="cbx_icon"></div><div class="cbx_caption">Bigas</div></div>'
					);
					$(`#gpwnd_${wndid}`).on('click', '.sentries_x1', function () {
						let unit = selecionarUnidade(false, false);
						if (!unit) {
							uw.HumanMessage.error('Nenhuma tropa disponível');
							return;
						}
						let lista = obterCidades(coordX, coordY);
						let cidades_jogador = jogadorTemCidades(lista);
						for (let i = 0; i < cidades_jogador.length; i++) {
							lista = lista.filter((item) => item !== cidades_jogador[i]);
							lista = removerSentinela(lista, 1, cidades_jogador[i]);
							lista = removerSuporte(lista, cidades_jogador[i]);
						}
						lista = removerAliancas(lista);
						let enviosFeitos = 0;
						for (let i = 0; i < lista.length; i++) {
							if (temSentinela(lista[i])) continue;
							if (estaNaListaNegra(lista[i])) continue;
							enviosFeitos++;
							setTimeout(() => {
								let unit = selecionarUnidade(false, false);
								if (!unit) return;
								if (temSentinela(lista[i])) return;
								if (estaNaListaNegra(lista[i])) return;
								enviarSentinela(unit, lista[i]);
							}, i * 500);
						}
						if (enviosFeitos === 0) {
							uw.HumanMessage.error('Nenhum alvo encontrado nesta ilha');
						}
					});
					$(`#gpwnd_${wndid}`).on('click', '.sentinela_check_cavaleiro', function () {
						$(this).toggleClass('checked');
					});
					$(`#gpwnd_${wndid}`).on('click', '.sentinela_check_bigas', function () {
						$(this).toggleClass('checked');
					});
					$(`#gpwnd_${wndid}`).on('click', '.sentries_global', function () {
						const checkCav = $(`#gpwnd_${wndid}`).find('.sentinela_check_cavaleiro').hasClass('checked');
						const checkBig = $(`#gpwnd_${wndid}`).find('.sentinela_check_bigas').hasClass('checked');
						permitirCavaleiro = checkCav;
						permitirBigas = checkBig;
						enviarSentinelaGlobal();
					});
				}
			}
		}
	});

	/* Intercepta resposta do send_units */
	$(document).ajaxComplete(function (event, xhr, settings) {
		if (settings.url && settings.url.indexOf('send_units') !== -1) {
			var teveErro = false;
			try {
				var resp = JSON.parse(xhr.responseText);
				if (resp.json && resp.json.error) {
					teveErro = true;
					var targetId = null;
					if (settings.data) {
						var dados = typeof settings.data === 'string' ? settings.data : JSON.stringify(settings.data);
						var jsonMatch = dados.match(/json=([^&]+)/);
						if (jsonMatch) {
							try {
								var decoded = decodeURIComponent(jsonMatch[1]);
								var parsed = JSON.parse(decoded);
								targetId = parsed.id;
							} catch (e2) {}
						}
						if (!targetId) {
							var match = dados.match(/id[=:](\d+)/);
							if (match) targetId = match[1];
						}
					}
					if (targetId) {
						adicionarListaNegra(targetId);
					}
				}
			} catch (e) {}
			if (pendingResolve) {
				setTimeout(function () { pendingResolve({ success: !teveErro }); }, 0);
			}
		}
	});

	// ========================
	// Sentinela Global (UI e execução)
	// ========================

	function criarBarraProgresso() {
		const existing = document.getElementById('sentinela_progresso');
		if (existing) existing.remove();
		cancelarEnvio = false;
		const barra = document.createElement('div');
		barra.id = 'sentinela_progresso';
		barra.style.cssText = 'position:fixed;bottom:20px;right:60px;background:rgba(0,0,0,0.85);color:white;padding:10px 14px;border-radius:6px;font-family:Arial,sans-serif;font-size:12px;z-index:10000;min-width:220px;box-shadow:0 4px 12px rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.1);';
		barra.innerHTML = '<div id="sentinela_progresso_titulo" style="margin-bottom:6px;font-weight:bold;font-size:13px;">Sentinela Global</div>' +
			'<div id="sentinela_progresso_texto" style="margin-bottom:6px;">Preparando...</div>' +
			'<div style="background:#333;border-radius:3px;overflow:hidden;height:16px;">' +
			'<div id="sentinela_progresso_barra" style="background:linear-gradient(90deg,#4CAF50,#45a049);height:100%;width:0%;transition:width 0.3s ease;"></div></div>' +
			'<div id="sentinela_progresso_contador" style="margin-top:4px;font-size:11px;color:#aaa;text-align:right;">0/0</div>' +
			'<div id="sentinela_progresso_cancelar" style="margin-top:6px;text-align:center;cursor:pointer;padding:4px 10px;background:#c0392b;border-radius:3px;font-size:11px;font-weight:bold;">Cancelar</div>';
		document.body.appendChild(barra);
		document.getElementById('sentinela_progresso_cancelar').onclick = function () {
			cancelarEnvio = true;
			mostrarBarraProgresso(false);
			uw.HumanMessage.error('Envio cancelado');
			console.log('[Dark Sentinel] Envio cancelado pelo usuário');
		};
	}

	function atualizarTituloProgresso(titulo) {
		const el = document.getElementById('sentinela_progresso_titulo');
		if (el) el.textContent = titulo;
	}

	function mostrarBarraProgresso(mostrar) {
		const barra = document.getElementById('sentinela_progresso');
		if (barra) barra.style.display = mostrar ? 'block' : 'none';
	}

	function atualizarBarraProgresso(enviados, total) {
		const texto = document.getElementById('sentinela_progresso_texto');
		const barra = document.getElementById('sentinela_progresso_barra');
		const contador = document.getElementById('sentinela_progresso_contador');
		if (texto) texto.textContent = enviados >= total ? 'Concluído!' : 'Enviando sentinelas...';
		if (barra) barra.style.width = (total > 0 ? (enviados / total) * 100 : 0) + '%';
		if (contador) contador.textContent = enviados + '/' + total;
	}

	function enviarSentinelaGlobal() {
		const cidadesJogador = [];
		for (let id in uw.ITowns.towns) {
			cidadesJogador.push(uw.ITowns.towns[id]);
		}
		if (cidadesJogador.length === 0) {
			uw.HumanMessage.error('Nenhuma cidade encontrada');
			return;
		}

		const ilhas = {};
		for (let i = 0; i < cidadesJogador.length; i++) {
			const cidade = cidadesJogador[i];
			const ilhaX = cidade.getIslandCoordinateX();
			const ilhaY = cidade.getIslandCoordinateY();
			const chaveIlha = ilhaX + '_' + ilhaY;
			if (!ilhas[chaveIlha]) ilhas[chaveIlha] = [];
			ilhas[chaveIlha].push(cidade);
		}

		const chavesIlha = Object.keys(ilhas);
		const filaPorIlha = {};
		const ordemIlhas = [];
		let indiceIlha = 0;
		dsDebug('Total de ilhas para processar: ' + chavesIlha.length);

		criarBarraProgresso();
		mostrarBarraProgresso(true);
		atualizarTituloProgresso('Sentinela Global');
		atualizarBarraProgresso(0, chavesIlha.length);
		const textoProg = document.getElementById('sentinela_progresso_texto');
		if (textoProg) textoProg.textContent = 'Preparando ilhas...';

		function processarProximaIhla() {
			try {
				if (indiceIlha >= chavesIlha.length) {
					dsDebug('Todas as ilhas processadas');
					if (textoProg) textoProg.textContent = 'Todas as ilhas processadas';
					atualizarBarraProgresso(chavesIlha.length, chavesIlha.length);
					iniciarEnvios();
					return;
				}

				const chaveIlha = chavesIlha[indiceIlha];
				indiceIlha++;
				dsDebug('Processando ilha ' + indiceIlha + '/' + chavesIlha.length + ': ' + chaveIlha);

				const cidadesIlha = ilhas[chaveIlha];
				const partes = chaveIlha.split('_');
				const ilhaX = partes[0];
				const ilhaY = partes[1];

				let todasCidadesIlha = obterCidades(ilhaX, ilhaY);
				todasCidadesIlha = removerAliancas(todasCidadesIlha);

				const minhasCidades = cidadesIlha.map(function (c) { return String(c.id); });
				let cidadesAlvo = todasCidadesIlha.filter(function (id) {
					return minhasCidades.indexOf(String(id)) === -1;
				});

				const enviosIlha = [];
				for (let j = 0; j < cidadesIlha.length; j++) {
					const cidadeOrigem = cidadesIlha[j];
					if (!obterUnidadeParaCidade(cidadeOrigem.id, permitirCavaleiro, permitirBigas)) continue;
					for (let k = 0; k < cidadesAlvo.length; k++) {
						const cidadeAlvoId = cidadesAlvo[k];
						if (estaNaListaNegra(cidadeAlvoId)) continue;
						if (temSentinela(cidadeAlvoId)) continue;
						if (temSuporteACaminho(cidadeAlvoId)) continue;
						if (temSentinelaDe(cidadeOrigem.id, cidadeAlvoId)) continue;
						enviosIlha.push({ origem: cidadeOrigem.id, destino: cidadeAlvoId });
					}
				}

				if (enviosIlha.length > 0) {
					filaPorIlha[chaveIlha] = enviosIlha;
					ordemIlhas.push(chaveIlha);
				}

				atualizarBarraProgresso(indiceIlha, chavesIlha.length);
				if (textoProg) textoProg.textContent = 'Preparando ilhas... ' + indiceIlha + '/' + chavesIlha.length;
			} catch (e) {
				dsDebug('Erro ao processar ilha: ' + (e.message || e));
			}

			setTimeout(processarProximaIhla, 50);
		}

		async function iniciarEnvios() {
			if (ordemIlhas.length === 0) {
				uw.HumanMessage.error('Nenhuma sentinela para enviar');
				mostrarBarraProgresso(false);
				return;
			}

			let totalEnvios = 0;
			for (let i = 0; i < ordemIlhas.length; i++) {
				totalEnvios += filaPorIlha[ordemIlhas[i]].length;
			}

			atualizarTituloProgresso('Enviando Sentinelas');
			atualizarBarraProgresso(0, totalEnvios);
			if (textoProg) textoProg.textContent = 'Enviando...';
			dsDebug('Ilhas com envios: ' + ordemIlhas.join(', '));

			let enviadas = 0;
			let semUnidades = 0;
			let processadas = 0;

			for (let i = 0; i < ordemIlhas.length; i++) {
				if (cancelarEnvio) { dsDebug('Envio cancelado'); break; }
				if (i > 0) await delay(2500 + Math.floor(Math.random() * 500) - 250);

				const chaveIlha = ordemIlhas[i];
				const enviosIlha = filaPorIlha[chaveIlha];

				for (let j = 0; j < enviosIlha.length; j++) {
					if (cancelarEnvio) { dsDebug('Envio cancelado'); break; }
					const envio = enviosIlha[j];
					const unidade = obterUnidadeParaCidade(envio.origem, permitirCavaleiro, permitirBigas);
					if (unidade) {
						var resultado = await enviarSentinelaPromise(unidade, envio.destino, envio.origem);
						if (resultado && resultado.success) {
							enviadas++;
						}
					} else {
						semUnidades++;
					}
					processadas++;
					atualizarBarraProgresso(processadas, totalEnvios);
					if (j < enviosIlha.length - 1) {
						await delay(1500 + Math.floor(Math.random() * 500) - 250);
					}
				}
			}

			setTimeout(function () {
				mostrarBarraProgresso(false);
				if (semUnidades > 0) {
					uw.HumanMessage.error(enviadas + ' enviadas, ' + semUnidades + ' sem unidades');
				} else {
					uw.HumanMessage.success(enviadas + ' sentinelas enviadas com sucesso!');
				}
			}, 500);
		}

		setTimeout(processarProximaIhla, 100);
	}

	// ========================
	// Inicialização
	// ========================

	function aguardarJogo(callback) {
		if (typeof uw.ITowns !== 'undefined' && typeof uw.gpAjax !== 'undefined' && typeof uw.MM !== 'undefined' && typeof uw.GameEvents !== 'undefined') {
			callback();
		} else {
			setTimeout(function () { aguardarJogo(callback); }, 500);
		}
	}

	window.addEventListener('load', function () {
		aguardarJogo(function () {
			configurarIndicador();
			setTimeout(atualizarMapa, 1500);
		});
	});

})();
