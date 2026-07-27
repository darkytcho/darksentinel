// ==UserScript==
// @name         Dark Sentinel
// @version      1.7.7
// @author       Dark Rebel
// @description  Envio automatizado de sentinelas, botão no contexto e indicador no mapa
// @updateURL    https://github.com/darkytcho/darksentinel/releases/latest/download/DarkSentinel.obs.user.js
// @downloadURL  https://github.com/darkytcho/darksentinel/releases/latest/download/DarkSentinel.obs.user.js
// @include      http://*.grepolis.com/game/*
// @include      https://*.grepolis.com/game/*
// @grant        none
// ==/UserScript==

(function () {
	'use strict';
	const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

	function dsDebug() {}

	// ========================
	// Dados do servidor
	// ========================
	let lista_cidades = [];
	let lista_jogadores = [];
	let lista_aliancas = [];
	let mapaNomesAliancas = {};
	let cacheCidadesPorIlha = {};

	function carregarDadosServidor() {
		lista_cidades = [];
		lista_jogadores = [];
		lista_aliancas = [];
		mapaNomesAliancas = {};
		cacheCidadesPorIlha = {};
		$.ajax({ method: 'get', url: '/data/towns.txt' }).done(function (m) {
			try {
				$.each(m.split(/\r\n|\n/), function (C, J) {
					if (J.trim()) {
						const cols = J.split(/,/);
						cols[2] = decodificarHTML(cols[2]);
						lista_cidades.push(cols);
					}
				});
			} catch (C) {}
		});
		$.ajax({ method: 'get', url: '/data/players.txt' }).done(function (m) {
			try {
				$.each(m.split(/\r\n|\n/), function (C, J) {
					if (J.trim()) {
						const cols = J.split(/,/);
						cols[1] = decodificarHTML(cols[1]);
						lista_jogadores.push(cols);
					}
				});
			} catch (C) {}
		});
		$.ajax({ method: 'get', url: '/data/alliances.txt' }).done(function (m) {
			try {
				$.each(m.split(/\r\n|\n/), function (C, J) {
					if (J.trim()) {
						const cols = J.split(/,/);
						lista_aliancas.push(cols);
						mapaNomesAliancas[String(cols[0])] = decodificarHTML(cols[1]);
					}
				});
			} catch (C) {}
		});
	}

	carregarDadosServidor();
	setInterval(carregarDadosServidor, 60 * 60 * 1000);

	// ========================
	// Funções compartilhadas
	// ========================

	function decodificarHTML(texto) {
		if (!texto) return texto;
		texto = texto.replace(/\+/g, ' ');
		try { texto = decodeURIComponent(texto); } catch (e) {}
		const el = document.createElement('div');
		el.innerHTML = texto;
		return el.textContent;
	}

	/* Envia sentinela para a cidade alvo. source_id opcional = cidade de origem. */
	function enviarSentinela(unit, target_id, source_id) {
		let data = { id: parseInt(target_id), type: 'support' };
		data[unit] = 1;
		if (source_id) data.town_id = parseInt(source_id);
		uw.gpAjax.ajaxPost('town_info', 'send_units', data);
	}

	/* Retorna a unidade disponível na cidade atual (respeita config) */
	function selecionarUnidade(cfg) {
		if (!cfg) cfg = carregarConfig();
		let units = uw.ITowns.getCurrentTown().getLandUnits();
		const ordem = cfg.ordemTerra || PADRAO_ORDEM_TERRA;
		for (let i = 0; i < ordem.length; i++) {
			const k = ordem[i];
			if (cfg.terra[k] && units[k] > 0) return k;
		}
		return null;
	}

	/* Verifica se a cidade já tem sentinela (tropas próprias) */
	function temSentinela(id) {
		const towns = Object.keys(uw.ITowns.towns);
		const modelos = uw.ITowns.all_supporting_units.fragments[id];
		if (!modelos) return false;
		for (let model of modelos.models) {
			if (towns.indexOf(String(model.attributes.current_town_id)) !== -1) return true;
		}
		return false;
	}

	/* Verifica se a cidade tem suporte a caminho */
	function temSuporteACaminho(target_id) {
		let movments = uw.MM.getModels().MovementsUnits;
		for (let m in movments) if (movments[m].attributes.target_town_id == target_id) return true;
		let support = uw.MM.getModels().MovementsSupport;
		if (support) for (let m in support) if (support[m].attributes.target_town_id == target_id) return true;
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

	const CHAVE_LISTA_NEGRA = '\x6c\x6e';
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
		const cfg = carregarConfig();
		if (!cfg.listaNegraAtiva) return false;
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
	}

	// ========================
	// Botão de Sentinela (menu de contexto)
	// ========================

	function tratarCliqueMenuContexto(data) {
		let cfg = carregarConfig();
		const cidadesJogador = Object.keys(uw.ITowns.towns);
		for (let i = 0; i < cidadesJogador.length; i++) {
			const cid = cidadesJogador[i];
			const cidade = uw.ITowns.towns[cid];
			if (cidade.getIslandCoordinateX() != data.x || cidade.getIslandCoordinateY() != data.y) continue;
			const unitTerra = obterUnidadeParaCidade(cid, cfg);
			if (unitTerra) { enviarSentinela(unitTerra, data.id, cid); return; }
			const unitNaval = obterUnidadeNaval(cid, cfg);
			if (unitNaval) { enviarSentinela(unitNaval, data.id, cid); return; }
		}
		uw.HumanMessage.error('Nenhuma tropa disponível');
	}

	uw.$.Observer(uw.GameEvents.map.town.click).subscribe((e, data) => {
		if (!cidadeEstaNaIlha(data.x, data.y)) return;
		if (temSentinela(data.id)) return;
		if (temSuporteACaminho(data.id)) return;
		if (estaNaListaNegra(data.id)) return;
		let menu = uw.$('#context_menu');
		if (!menu) return;
		let div = document.createElement('div');
		div.id = 'm1';
		div.style.width = '50px';
		div.style.height = '50px';
		div.style.position = 'absolute';
		div.style.background = 'url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAMAAAAp4XiDAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAMAUExURQMDAwwLCxEPDR8YDhQRDhoUDBUTERoWEh4ZFB4eHiQcDSMdFSMeGC0hDTEjDD0sDScgFyohFCYgGSskGi8oHjMnFDAnHTIpHj80HyomICUkIy0pJCsrKzUsITkvIjIuKj0yJTYyKzs0KzQ0NDw5NDw8O0EuDUkzC0MwC0k2Fks3E0EyGkE1J0E4J0I2KEU5Kko9LUE7NEE+OFxBDl1BEVdBGFlDHWJDDGpJDHBMC31VCmlLFHdWGn9aFH1bHk1AL1ZGK1dGJ0ZDPU9BMFhKM1FDMW1RIWxVLHZaJnRXI3lcJnleLmZWN21ZNWlYOn9iLHxlPHxjNERDQklFQExJRktLS1BNSlRRTFNTUlxcXG1fRnllQnNjRWRiX3BmVXdrVGRjY2poZWxsbH14bnt2bHNzc3t7e4dcDoRcFJ9sDZVlDo5hEoxkGpRmEpxrEZ9yHqFtDrV6D6JvEa55GKdzFat2Fa94E6N0HbR7E7h+FLR+G4ZkI4RkK5JtKphzLIhsN4FnOKZ4IKp7JqN3KKR6LqN8MpR4RoV1VpF+XIF6bIJ+d4J+eL2BFLqCHLWCJq+DMraINbyNNcSHF8qLFsKGGsSIG8yNGs+QHdSRFtmTFdWTHNuXGt6aHOSdG+ujH8SLJMmRKc6RItaYJdSVI9yaI9aaK9qcLMGQOcWTN9WeOtCXMNScNuKeI9+iM9yjO+ShJeulJeOiLOumKe6qLPGqJvWtKuaqPOCiMO2rM+OnO+6vOvayNfm0NfKyPJ6CTZ2CU6qHSKmFQLWMQraQTKOMXrGPUbKRVLmZXY6CbZmJa4+IfYqCdISAeouFepSJdZKKfKmRZrSWYMWaTcKVRNCfQ8ScUs6gTdemSdumRtimScahXMykWt2tVOWtRuOqQuqyTPq5Q/O1QvG1SOKvUeSzWeWxVOq0VOq3Wve9VdavaP/BS/zAUf3FYImHhYODg4yMjJOPiZONg5SQiJWQhpOTk5ubm6iop6Ojo62trbS0tLu7u8LCwszMzNLS0tvb2wAAAKCc9U0AAAEAdFJOU////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////wBT9wclAAAACXBIWXMAAA7CAAAOwgEVKEqAAAAGZElEQVRIS62VCXDUZBTHs+k2SZstpPutCZQm/QRaRbNJAAcPxBXXVfECmRazKtoNbBgQD1BuRcVbUUbK2YJnZVQqUAoIKN4HChXvwcGDw1ubFcnSi7K+7IZty6gzzPifTmc2eb/53v+9970QqRPW/4f89VFjY+Nf7o/j9A/Ix59+tWbbb5v3/7Fq0xfvf+g+7KLjkYPv7q5/smrm1HvnTpgxfcnymvpv39nlvjqm7sifH2xZPPGcwWUFOSTp9eYXnHrWtKqahs8Puq8z6oZ8+EX1lLMKckmKZkA5DE3TOT0n1K6rf90NSKsrsmfVlLMLSIplWYQQj/gAQpyP8g6YsXLFE26Io07k0M+1E0/xUiyHkCBJkiiKgiQKvN9H5wxdVLem01EWOfTTykk9vAyLAoKEZVkOyjLGkiSIAseQp82urs8yWeTn9Tfm0yzHI0EQcVqqqqkOxHMsVfbY0kVuYBb5df/9heCCg6QwFvuW62MGylokHJKdHHkf1XPaqsfdUBf55PcvxVyu0MkpKA9ssq24Mba8rxaOaEFVlYM88g55catbtwxyaN+a4STYDmqaqoxtb29tMaP66DH9tZCGZVUNioglJ2/elulPBtlTNyyXEwKqpmlyrK2j44htxI1KPdpfVSWshkOY5+j8xRsypU4ju9ZM6UEhQQ6HNOWClraOI0k7CanFxoyVgooKllQR+ciLtjbsyCLv1w3z5kg4HA6p0uGW1rZk65GWZss09OjJihaKAALHsP7PXr0vi2yZWeblJDUCZq9OJpvt9qOQW5tt6roeDEcAUbCEeO+IV9ceQ7Y/NyGXCUDOEU224lairePo0Raz0rSiuiHDIfBYlngffVLthgdd5PWqM0k/L+IQ1CdhGC3tHUcNL0FQllWad4EWiYRUGUsCYqh5G+e6yAvzy0iWDUiyivtaMbu5tT1KEB6CKLb7Ef0w1F2NwClQ5/M2PuUiL0/pwXAiVoJBYVA8ZiebywkPiCCMKFFc4gwclEVEHDWkdmkGOfj0TQX+gAh9l/j+sbiZbKqgCFARURHLK4KBUBRNCUMB6NNfqW1MIzufuzmfS0+vJJRUxuO21ZI09Ip4gsyL6ubJWIbWqJoS5OmTtmx4OI1sr5vEgBEMwy5wlZVxy249nLRBxYReYfWHgYERUFQZMdzqlRlkR/VEBonOFcEiKo0ZZhKQRFPisE4UVVjliqYpMJoyBuSlGhepmcoiAa6HArXkjZhpNx9uhmOaDYLIswx4ocrQGREx/PMucrBuVg+/KMkhLYhxn8pYvAmKZifsZCLP49EtCQfDClw2kad7bXLtp56ZX8YERCUEpRQG6oZpWWDESiSTo6mifuYYrEa0sIYxIodvXej25allQ30CuNSwMCgWNQwLjCQSgBnFPp9uQmVEUZUlRI1suNlF7l9xI+34h77oeaXxuGVaDgAn9UZciVkuyTIPrWTot+oudZGHnlxc4AMzMBV9ikiqNN4ExzhIYhBCrG6JuJeIBUTzB6pvcJHU2vVDmYDgFAyxDEPnVZgJC1JL2EZvHvWOXy1iWBmcZ9S+WU50GlmwfjbrR9B/ZwUFeM7HlEahowD1hf2iG4AIPMO+WXtJFtleU3MGzQAC2wuWEAy6z1ccNW07GZMUqSQqYKm333vF6lvHZZHU40tuz6c4jGFFwgzAIhOEgL9PhWGacAwqBSdcLvpqxbnp4Ayya9mzc8gcuAAAAeGsVlFAfqaodLQINkQRluwDmyc+mg7OIKm7Fj0z2MOwcAcCgiA5twpqAdcqs9H5Qo66cnfV5ZlYF0lNnjX7NJL1swwHKxlmPQy3OqJBEWUeZhZRka+XZ9LqRFJTZ80Y4GUKkShhSQ4qYU1Ww0HIT+RRANEXftMwyQ3sRHZMn3nPEC/jhy8RLHLwI6kwioIAybH0dT82zHvEDexEUo3TFz57ZyHFIA6J8FVx/px4jvH0eeOXhvt2umFdEfCzbO0LF7MUA98MR/CfZXNI35V79r5yhxviqCuSump61fMLLpMYD+nNpelc0uOhSq79clPtY9e4AWl1Q1I758xfVrf67bvPlwN+fyB44aj3fti78ulRnUk56o6kUuNG3lbz2sat3x848O3u77a9tq5+9oj0lHTR8QjohpHTFlavWF9fu2T+LZdd7z7son9AHO0cN378uO75ZPUvyH/phJFU6m9BwH8KNwERVQAAAABJRU5ErkJggg==)';
		div.style.zIndex = 'auto';
		div.style.cursor = 'pointer';
		div.innerHTML = `
		<div id="m2" style="position: absolute;overflow: hidden;width: 118px;display: none;margin-left: -59px;left: 50%;top: 40px;z-index: 5;" >
		<div style="position: absolute; top: 0; left: 0; right: 0; background: url(https://gpit.innogamescdn.com/images/game/autogenerated/layout/layout_095495a.png) no-repeat -488px -406px; width: 118px; height: 18px;"></div>
		<div style="position: absolute; top: 18px; left: 0; right: 0; bottom: 11px; background: url(https://gpit.innogamescdn.com/images/game/layout/context_menu_middle.png) repeat-y 0 0;"></div>
		<div style="position: absolute; bottom: 0; left: 0; right: 0; background: url(https://gpit.innogamescdn.com/images/game/autogenerated/layout/layout_095495a.png) no-repeat -326px -240px; width: 118px; height: 11px;"></div>
		<div style="color: #fc6; font-weight: 700; text-align: center; word-wrap: break-word; line-height: 19px; z-index: 1; position: relative; padding: 4px;">Sentinela</div>
		</div>`;
		menu.append(div);
		uw.$('#m1').animate({ top: '-100px' }, 120);
		uw.$('#m1').hover(
			() => { uw.$('#m2').css('display', 'block'); },
			() => { uw.$('#m2').css('display', 'none'); },
		);
		uw.$('#m1').click(() => {
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
		div.id = 'm3';
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
		const map = document.getElementById('m3');
		if (!map) return false;
		const cfg = carregarConfig();
		const hue = cfg.corEscudo;
		const x = parseInt(cidade.style.left);
		const y = parseInt(cidade.style.top);
		const shield = document.createElement('div');
		shield.id = `s4_${cidadeId}`;
		shield.style.left = `${x - 29}px`;
		shield.style.top = `${y - 25}px`;
		shield.style.background =
			'url(https://gpit.innogamescdn.com/images/game/autogenerated/map/town_overlay/city_shield_cd2b0df.png) no-repeat 0 0';
		shield.style.width = '110px';
		shield.style.height = '72px';
		shield.style.position = 'absolute';
		shield.style.transform = 'translate(10px,10px)';
		shield.style.backgroundSize = '95%';
		if (hue !== 0) shield.style.filter = `hue-rotate(${hue}deg) saturate(5)`;
		map.appendChild(shield);
		return true;
	}

	function removerEscudoVerde(cidadeId) {
		const element = document.getElementById(`s4_${cidadeId}`);
		if (!element) return false;
		element.remove();
		return true;
	}

	function atualizarCorEscudos() {
		const cfg = carregarConfig();
		const hue = cfg.corEscudo;
		document.querySelectorAll('[id^="s4_"]').forEach(function (el) {
			if (hue === 0) el.style.filter = '';
			else el.style.filter = `hue-rotate(${hue}deg) saturate(5)`;
		});
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

	/* Filtra cidades por tipo (aliado, sem aliança, fantasma, inimigo) */
	function filtrarPorTipo(lista) {
		const cfg = carregarConfig();
		let aliancaModelos = uw.MM.getCollections().AlliancePact[0];
		let aliancaJogador = null;
		let aliancasInimigas = new Set();
		let aliancasAliadas = new Set();

		if (aliancaModelos && aliancaModelos.models.length) {
			aliancaJogador = aliancaModelos.models[0].attributes.alliance_1_id;
			for (let i = 0; i < aliancaModelos.models.length; i++) {
				let m = aliancaModelos.models[i].attributes;
				if (m.alliance_1_id == aliancaJogador) {
					if (m.relation == 'war') aliancasInimigas.add(String(m.alliance_2_id));
					else if (m.relation == 'ally') aliancasAliadas.add(String(m.alliance_2_id));
				} else if (m.alliance_2_id == aliancaJogador) {
					if (m.relation == 'war') aliancasInimigas.add(String(m.alliance_1_id));
					else if (m.relation == 'ally') aliancasAliadas.add(String(m.alliance_1_id));
				}
			}
		}

		let mapaJogador = {};
		for (let i = 0; i < lista_jogadores.length; i++) {
			mapaJogador[lista_jogadores[i][0]] = lista_jogadores[i][2];
		}
		let mapaCidadeJogador = {};
		for (let i = 0; i < lista_cidades.length; i++) {
			mapaCidadeJogador[lista_cidades[i][0]] = lista_cidades[i][1];
		}

		let minhasCidades = {};
		for (let id in uw.ITowns.towns) {
			minhasCidades[String(id)] = true;
		}

		return lista.filter((id) => {
			if (minhasCidades[String(id)]) return true;
			let jogadorID = mapaCidadeJogador[id];
			if (!jogadorID) return cfg.enviarFantasmas !== false;
			if (typeof mapaJogador[jogadorID] === 'undefined') return cfg.enviarFantasmas !== false;
			let aliancaID = mapaJogador[jogadorID];
			if (aliancaID == aliancaJogador) return true;

			if (cfg.modoEnvio === 'alianca') {
				if (!aliancaID) return cfg.enviarSemAlianca !== false;
				return cfg.aliancasSelecionadas.indexOf(String(aliancaID)) !== -1;
			}

			if (!aliancaID) return cfg.enviarSemAlianca !== false;
			if (aliancasInimigas.has(String(aliancaID))) return cfg.enviarInimigos === true;
			if (aliancasAliadas.has(String(aliancaID))) return cfg.enviarAliados !== false;
			return cfg.enviarSemAlianca !== false;
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

	/* Verifica se a ilha está na lista de ignoradas */
	function ilhaIgnorada(x, y) {
		const cfg = carregarConfig();
		const ilhas = cfg.ilhasIgnoradas || [];
		for (let i = 0; i < ilhas.length; i++) {
			if (String(ilhas[i].x) === String(x) && String(ilhas[i].y) === String(y)) return true;
		}
		return false;
	}

	// ========================
	// Configurações (preferências salvas)
	// ========================

	const CHAVE_CONFIG = '\x63\x66\x67';

	const UNIDADES_TERRA = [
		{ chave: 'sword', nome: 'Espadachim' },
		{ chave: 'archer', nome: 'Arqueiro' },
		{ chave: 'slinger', nome: 'Fundibulário' },
		{ chave: 'hoplite', nome: 'Hoplita' },
		{ chave: 'knight', nome: 'Cavaleiro' },
		{ chave: 'chariot', nome: 'Biga' }
	];

	const UNIDADES_NAVAL = [
		{ chave: 'bireme', nome: 'Birreme' },
		{ chave: 'fire_ship', nome: 'Navio-farol' },
		{ chave: 'trireme', nome: 'Trirreme' },
		{ chave: 'big_transport_ship', nome: 'Barco de transporte' },
		{ chave: 'transport_ship', nome: 'Navio de transporte rápido' }
	];

	const PADRAO_TERRA = { sword: true, archer: true, slinger: true, hoplite: true, knight: false, chariot: false };
	const PADRAO_NAVAL = { bireme: false, fire_ship: false, trireme: false, big_transport_ship: false, transport_ship: false };
	const PADRAO_ORDEM_TERRA = ['sword', 'archer', 'slinger', 'hoplite', 'knight', 'chariot'];
	const PADRAO_ORDEM_NAVAL = ['bireme', 'fire_ship', 'trireme', 'big_transport_ship', 'transport_ship'];

	function carregarConfig() {
		try {
			const cfg = JSON.parse(localStorage.getItem(CHAVE_CONFIG) || '{}');
			const terra = {};
			const naval = {};
			for (let i = 0; i < UNIDADES_TERRA.length; i++) {
				terra[UNIDADES_TERRA[i].chave] = cfg.terra && typeof cfg.terra[UNIDADES_TERRA[i].chave] !== 'undefined' ? !!cfg.terra[UNIDADES_TERRA[i].chave] : PADRAO_TERRA[UNIDADES_TERRA[i].chave];
			}
			for (let i = 0; i < UNIDADES_NAVAL.length; i++) {
				naval[UNIDADES_NAVAL[i].chave] = cfg.naval && typeof cfg.naval[UNIDADES_NAVAL[i].chave] !== 'undefined' ? !!cfg.naval[UNIDADES_NAVAL[i].chave] : PADRAO_NAVAL[UNIDADES_NAVAL[i].chave];
			}
			let ordemTerra = cfg.ordemTerra;
			let ordemNaval = cfg.ordemNaval;
			if (!Array.isArray(ordemTerra)) ordemTerra = PADRAO_ORDEM_TERRA.slice();
			if (!Array.isArray(ordemNaval)) ordemNaval = PADRAO_ORDEM_NAVAL.slice();
			return { terra: terra, naval: naval, ordemTerra: ordemTerra, ordemNaval: ordemNaval, listaNegraAtiva: typeof cfg.listaNegraAtiva !== 'undefined' ? !!cfg.listaNegraAtiva : true, overlayAtivo: typeof cfg.overlayAtivo !== 'undefined' ? !!cfg.overlayAtivo : true, enviarAliados: typeof cfg.enviarAliados !== 'undefined' ? !!cfg.enviarAliados : true, enviarSemAlianca: typeof cfg.enviarSemAlianca !== 'undefined' ? !!cfg.enviarSemAlianca : true, enviarFantasmas: typeof cfg.enviarFantasmas !== 'undefined' ? !!cfg.enviarFantasmas : true, enviarInimigos: typeof cfg.enviarInimigos !== 'undefined' ? !!cfg.enviarInimigos : false, ilhasIgnoradas: Array.isArray(cfg.ilhasIgnoradas) ? cfg.ilhasIgnoradas : [], modoEnvio: cfg.modoEnvio === 'alianca' ? 'alianca' : 'filtro', aliancasSelecionadas: Array.isArray(cfg.aliancasSelecionadas) ? cfg.aliancasSelecionadas : [], corEscudo: typeof cfg.corEscudo === 'number' ? cfg.corEscudo : 210 };
		} catch (e) {
			const terra = {};
			const naval = {};
			for (let i = 0; i < UNIDADES_TERRA.length; i++) terra[UNIDADES_TERRA[i].chave] = PADRAO_TERRA[UNIDADES_TERRA[i].chave];
			for (let i = 0; i < UNIDADES_NAVAL.length; i++) naval[UNIDADES_NAVAL[i].chave] = PADRAO_NAVAL[UNIDADES_NAVAL[i].chave];
			return { terra: terra, naval: naval, ordemTerra: PADRAO_ORDEM_TERRA.slice(), ordemNaval: PADRAO_ORDEM_NAVAL.slice(), listaNegraAtiva: true, overlayAtivo: true, enviarAliados: true, enviarSemAlianca: true, enviarFantasmas: true, enviarInimigos: false, ilhasIgnoradas: [], modoEnvio: 'filtro', aliancasSelecionadas: [], corEscudo: 210 };
		}
	}

	function salvarConfig(cfg) {
		localStorage.setItem(CHAVE_CONFIG, JSON.stringify(cfg));
	}

	function abrirConfig() {
		const cfg = carregarConfig();
		if (document.getElementById('c1')) return;

		const modal = document.createElement('div');
		modal.id = 'c1';
		modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;display:flex;align-items:center;justify-content:center;';

		const overlay = document.createElement('div');
		overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);';
		overlay.onclick = function () { modal.remove(); };

		const box = document.createElement('div');
		box.style.cssText = 'position:relative;background:#2a1a0e;border:2px solid #8b6914;border-radius:8px;padding:20px;min-width:280px;max-height:80vh;overflow-y:auto;color:#fc6;font-family:Arial,sans-serif;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,0.6);';

		const titulo = document.createElement('div');
		titulo.style.cssText = 'font-size:15px;font-weight:bold;margin-bottom:6px;text-align:center;border-bottom:1px solid #8b6914;padding-bottom:8px;';
		titulo.textContent = 'Configurações - Dark Sentinel (1.7.0)';
		box.appendChild(titulo);

		const descGeral = document.createElement('div');
		descGeral.style.cssText = 'font-size:12px;color:#aaa;margin-bottom:14px;line-height:1.5;text-align:left;';
		descGeral.innerHTML = '<b style="color:#fc6">Terrestre</b> — Envia 1 tropa terrestre de uma ilha para cidades aliadas na mesma ilha.<br><b style="color:#fc6">Naval</b> — Envia 1 tropa naval de uma ilha para cidades aliadas na mesma ilha.<br><b style="color:#fc6">Prioridade:</b> As sentinelas terrestres são enviadas primeiro. A primeira unidade disponível na lista (de cima para baixo) é enviada.';
		box.appendChild(descGeral);

		function criarCheck(label, chave, grupo, idx) {
			const valor = cfg[grupo][chave];
			const row = document.createElement('div');
			row.style.cssText = 'display:flex;align-items:center;margin:3px 0;padding:4px 6px;border-radius:4px;cursor:grab;user-select:none;';
			row.draggable = true;
			row.dataset.chave = chave;
			row.onmouseover = function () { row.style.background = 'rgba(255,255,255,0.08)'; };
			row.onmouseout = function () { row.style.background = 'transparent'; };
			row.ondragstart = function (e) {
				row.style.opacity = '0.4';
				e.dataTransfer.setData('text/plain', chave);
				e.dataTransfer.effectAllowed = 'move';
			};
			row.ondragend = function () { row.style.opacity = '1'; };
			row.ondragover = function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; row.style.background = 'rgba(212,160,23,0.3)'; };
			row.ondragleave = function () { row.style.background = 'transparent'; };
			row.ondrop = function (e) {
				e.preventDefault();
				row.style.background = 'transparent';
				const dragged = e.dataTransfer.getData('text/plain');
				const ordemKey = grupo === 'terra' ? 'ordemTerra' : 'ordemNaval';
				const ordem = cfg[ordemKey];
				const fromIdx = ordem.indexOf(dragged);
				const toIdx = ordem.indexOf(chave);
				if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
				ordem.splice(fromIdx, 1);
				ordem.splice(toIdx, 0, dragged);
				salvarConfig(cfg);
				modal.remove();
				abrirConfig();
			};

			const num = document.createElement('div');
			num.style.cssText = 'width:18px;font-size:11px;color:#8b6914;font-weight:bold;text-align:center;flex-shrink:0;';
			num.textContent = idx + 1 + '.';

			const cb = document.createElement('div');
			cb.style.cssText = 'width:16px;height:16px;border:2px solid #8b6914;border-radius:3px;margin-right:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;cursor:pointer;' + (valor ? 'background:#4CAF50;border-color:#4CAF50;' : 'background:#1a1a1a;');

			const icon = document.createElement('div');
			icon.style.cssText = 'color:white;font-size:11px;font-weight:bold;line-height:1;' + (valor ? '' : 'display:none;');
			icon.textContent = '\u2713';
			cb.appendChild(icon);

			const txt = document.createElement('span');
			txt.style.cssText = 'font-size:12px;color:#fc6;';

			const iconDrag = document.createElement('span');
			iconDrag.style.cssText = 'font-size:10px;color:#666;margin-right:6px;';
			iconDrag.textContent = '\u2630';

			txt.textContent = label;

			row.appendChild(num);
			row.appendChild(iconDrag);
			row.appendChild(cb);
			row.appendChild(txt);
			cb.onclick = function (e) {
				e.stopPropagation();
				cfg[grupo][chave] = !cfg[grupo][chave];
				cb.style.background = cfg[grupo][chave] ? '#4CAF50' : '#1a1a1a';
				cb.style.borderColor = cfg[grupo][chave] ? '#4CAF50' : '#8b6914';
				icon.style.display = cfg[grupo][chave] ? '' : 'none';
				salvarConfig(cfg);
			};
			return row;
		}

		function criarSecao(titulo, unidades, grupo) {
			const sec = document.createElement('div');
			sec.style.cssText = 'margin-bottom:12px;';
			const cab = document.createElement('div');
			cab.style.cssText = 'font-size:13px;font-weight:bold;color:#d4a017;margin-bottom:4px;padding-bottom:4px;border-bottom:1px solid rgba(139,105,20,0.4);';
			cab.textContent = titulo;
			sec.appendChild(cab);
			const ordemKey = grupo === 'terra' ? 'ordemTerra' : 'ordemNaval';
			const ordem = cfg[ordemKey] || PADRAO_ORDEM_TERRA;
			for (let i = 0; i < ordem.length; i++) {
				const unidade = unidades.find(function (u) { return u.chave === ordem[i]; });
				if (unidade) sec.appendChild(criarCheck(unidade.nome, unidade.chave, grupo, i));
			}
			return sec;
		}

		const colunas = document.createElement('div');
		colunas.style.cssText = 'display:flex;gap:16px;margin-bottom:12px;';

		const colTerra = document.createElement('div');
		colTerra.style.cssText = 'flex:1;min-width:0;';
		colTerra.appendChild(criarSecao('Terra', UNIDADES_TERRA, 'terra'));

		const colNaval = document.createElement('div');
		colNaval.style.cssText = 'flex:1;min-width:0;';
		colNaval.appendChild(criarSecao('Naval', UNIDADES_NAVAL, 'naval'));

		const colAlvos = document.createElement('div');
		colAlvos.style.cssText = 'flex:1;min-width:0;';

		const secAlvos = document.createElement('div');
		secAlvos.style.cssText = 'margin-bottom:0;';
		const cabAlvos = document.createElement('div');
		cabAlvos.style.cssText = 'font-size:13px;font-weight:bold;color:#d4a017;margin-bottom:4px;padding-bottom:4px;border-bottom:1px solid rgba(139,105,20,0.4);';
		cabAlvos.textContent = 'Enviar Sentinela Para';
		secAlvos.appendChild(cabAlvos);

		const tabsContainer = document.createElement('div');
		tabsContainer.style.cssText = 'display:flex;gap:2px;margin-bottom:8px;';

		const conteudoAlvos = document.createElement('div');

		function criarTab(texto, chave) {
			const tab = document.createElement('div');
			tab.style.cssText = 'flex:1;text-align:center;padding:4px 6px;border-radius:3px;font-size:11px;font-weight:bold;cursor:pointer;border:1px solid ' + (cfg.modoEnvio === chave ? '#d4a017' : '#555') + ';' + (cfg.modoEnvio === chave ? 'background:#3a2a10;color:#fc6;' : 'background:#1a1a1a;color:#888;');
			tab.textContent = texto;
			return tab;
		}

		const tabFiltro = criarTab('Filtro', 'filtro');
		const tabAlianca = criarTab('Por Aliança', 'alianca');
		tabsContainer.appendChild(tabFiltro);
		tabsContainer.appendChild(tabAlianca);
		secAlvos.appendChild(tabsContainer);

		function renderizarConteudoAlvos() {
			conteudoAlvos.innerHTML = '';
			if (cfg.modoEnvio === 'filtro') {
				const opcoesAlvo = [
					{ chave: 'enviarAliados', titulo: 'Alianças aliadas' },
					{ chave: 'enviarSemAlianca', titulo: 'Sem aliança' },
					{ chave: 'enviarFantasmas', titulo: 'Fantasmas' },
					{ chave: 'enviarInimigos', titulo: 'Inimigos' }
				];
				for (let i = 0; i < opcoesAlvo.length; i++) {
					const op = opcoesAlvo[i];
					const row = document.createElement('div');
					row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin:5px 0;padding:3px 6px;border-radius:4px;cursor:pointer;';
					row.onmouseover = function () { row.style.background = 'rgba(255,255,255,0.08)'; };
					row.onmouseout = function () { row.style.background = 'transparent'; };
					const txt = document.createElement('span');
					txt.style.cssText = 'font-size:11px;color:#fc6;';
					txt.textContent = op.titulo;
					const cb = document.createElement('div');
					cb.style.cssText = 'width:14px;height:14px;border:2px solid #8b6914;border-radius:3px;display:flex;align-items:center;justify-content:center;flex-shrink:0;' + (cfg[op.chave] ? 'background:#4CAF50;border-color:#4CAF50;' : 'background:#1a1a1a;');
					const icon = document.createElement('div');
					icon.style.cssText = 'color:white;font-size:10px;font-weight:bold;line-height:1;' + (cfg[op.chave] ? '' : 'display:none;');
					icon.textContent = '\u2713';
					cb.appendChild(icon);
					row.appendChild(txt);
					row.appendChild(cb);
					row.onclick = function () {
						cfg[op.chave] = !cfg[op.chave];
						cb.style.background = cfg[op.chave] ? '#4CAF50' : '#1a1a1a';
						cb.style.borderColor = cfg[op.chave] ? '#4CAF50' : '#8b6914';
						icon.style.display = cfg[op.chave] ? '' : 'none';
						salvarConfig(cfg);
					};
					conteudoAlvos.appendChild(row);
				}
			} else {
				const opcoesExtra = [
					{ chave: 'enviarSemAlianca', titulo: 'Sem aliança' },
					{ chave: 'enviarFantasmas', titulo: 'Fantasmas' }
				];
				for (let i = 0; i < opcoesExtra.length; i++) {
					const op = opcoesExtra[i];
					const row = document.createElement('div');
					row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin:5px 0;padding:3px 6px;border-radius:4px;cursor:pointer;';
					row.onmouseover = function () { row.style.background = 'rgba(255,255,255,0.08)'; };
					row.onmouseout = function () { row.style.background = 'transparent'; };
					const txt = document.createElement('span');
					txt.style.cssText = 'font-size:11px;color:#fc6;';
					txt.textContent = op.titulo;
					const cb = document.createElement('div');
					cb.style.cssText = 'width:14px;height:14px;border:2px solid #8b6914;border-radius:3px;display:flex;align-items:center;justify-content:center;flex-shrink:0;' + (cfg[op.chave] ? 'background:#4CAF50;border-color:#4CAF50;' : 'background:#1a1a1a;');
					const icon = document.createElement('div');
					icon.style.cssText = 'color:white;font-size:10px;font-weight:bold;line-height:1;' + (cfg[op.chave] ? '' : 'display:none;');
					icon.textContent = '\u2713';
					cb.appendChild(icon);
					row.appendChild(txt);
					row.appendChild(cb);
					row.onclick = (function (chave, cbRef, iconRef) {
						return function () {
							cfg[chave] = !cfg[chave];
							cbRef.style.background = cfg[chave] ? '#4CAF50' : '#1a1a1a';
							cbRef.style.borderColor = cfg[chave] ? '#4CAF50' : '#8b6914';
							iconRef.style.display = cfg[chave] ? '' : 'none';
							salvarConfig(cfg);
						};
					})(op.chave, cb, icon);
					conteudoAlvos.appendChild(row);
				}

				const linhaAli = document.createElement('div');
				linhaAli.style.cssText = 'display:flex;gap:4px;margin-bottom:6px;position:relative;z-index:1;';
				const inputAli = document.createElement('input');
				inputAli.type = 'text';
				inputAli.placeholder = 'Pesquisar aliança...';
				inputAli.style.cssText = 'flex:1;min-width:0;padding:4px 6px;background:#1a1a1a;border:1px solid #8b6914;border-radius:3px;color:#fc6;font-size:12px;font-family:Arial,sans-serif;';
				const btnAdicAli = document.createElement('div');
				btnAdicAli.style.cssText = 'cursor:pointer;padding:4px 8px;background:#8b6914;border-radius:3px;font-size:11px;font-weight:bold;color:#fff;white-space:nowrap;';
				btnAdicAli.textContent = 'Adicionar';
				btnAdicAli.onmouseover = function () { btnAdicAli.style.background = '#a67c1a'; };
				btnAdicAli.onmouseout = function () { btnAdicAli.style.background = '#8b6914'; };
				linhaAli.appendChild(inputAli);
				linhaAli.appendChild(btnAdicAli);

				const dropdown = document.createElement('div');
				dropdown.style.cssText = 'position:absolute;top:100%;left:0;right:0;background:#1a1a1a;border:1px solid #8b6914;border-radius:0 0 3px 3px;max-height:150px;overflow-y:auto;z-index:100002;display:none;';
				linhaAli.appendChild(dropdown);
				conteudoAlvos.appendChild(linhaAli);

				let aliSelecionada = null;

				const mapaAliancas = {};
				for (let i = 0; i < lista_jogadores.length; i++) {
					const alId = lista_jogadores[i][2];
					if (alId && !mapaAliancas[alId]) mapaAliancas[alId] = { id: alId, nome: mapaNomesAliancas[String(alId)] || 'Aliança ' + alId, membros: 0 };
				}
				for (let i = 0; i < lista_jogadores.length; i++) {
					const alId = lista_jogadores[i][2];
					if (alId && mapaAliancas[alId]) mapaAliancas[alId].membros++;
				}
				const aliancas = Object.values(mapaAliancas).sort(function (a, b) { return b.membros - a.membros; });

				function renderizarDropdown(filtro) {
					dropdown.innerHTML = '';
					const termo = (filtro || '').toLowerCase();
					const filtradas = termo ? aliancas.filter(function (a) { return a.nome.toLowerCase().indexOf(termo) !== -1 || String(a.id).indexOf(termo) !== -1; }) : aliancas;
					const limitadas = filtradas.slice(0, 50);
					for (let i = 0; i < limitadas.length; i++) {
						const al = limitadas[i];
						const item = document.createElement('div');
						item.style.cssText = 'padding:5px 8px;font-size:11px;cursor:pointer;color:#fc6;border-bottom:1px solid rgba(139,105,20,0.2);';
						item.textContent = al.nome + ' (' + al.id + ') — ' + al.membros + ' membros';
						item.onmouseover = function () { item.style.background = 'rgba(255,255,255,0.1)'; };
						item.onmouseout = function () { item.style.background = 'transparent'; };
						item.onclick = (function (alianca) {
							return function (e) {
								e.stopPropagation();
								aliSelecionada = alianca;
								inputAli.value = alianca.nome + ' (' + alianca.id + ')';
								dropdown.style.display = 'none';
							};
						})(al);
						dropdown.appendChild(item);
					}
					if (limitadas.length === 0) {
						const vazio = document.createElement('div');
						vazio.style.cssText = 'padding:5px 8px;font-size:11px;color:#666;font-style:italic;';
						vazio.textContent = 'Nenhuma aliança encontrada.';
						dropdown.appendChild(vazio);
					}
				}

				inputAli.onfocus = function () {
					aliSelecionada = null;
					renderizarDropdown(inputAli.value);
					dropdown.style.display = 'block';
				};

				inputAli.oninput = function () {
					aliSelecionada = null;
					renderizarDropdown(inputAli.value);
					dropdown.style.display = 'block';
				};

				document.addEventListener('click', function (e) {
					if (!linhaAli.contains(e.target)) dropdown.style.display = 'none';
				});

				function renderizarListaAliancas() {
					const antiga = conteudoAlvos.querySelector('.lista-aliancas');
					if (antiga) antiga.remove();
					const listaEl = document.createElement('div');
					listaEl.className = 'lista-aliancas';
					listaEl.style.cssText = 'max-height:120px;overflow-y:auto;';
					if (!cfg.aliancasSelecionadas || cfg.aliancasSelecionadas.length === 0) {
						const vazio = document.createElement('div');
						vazio.style.cssText = 'font-size:11px;color:#666;font-style:italic;';
						vazio.textContent = 'Nenhuma aliança adicionada.';
						listaEl.appendChild(vazio);
					} else {
						for (let i = 0; i < cfg.aliancasSelecionadas.length; i++) {
							const alId = cfg.aliancasSelecionadas[i];
							const nome = mapaNomesAliancas[String(alId)] || 'Aliança ' + alId;
							const row = document.createElement('div');
							row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:3px 6px;border-radius:3px;margin:2px 0;';
							row.onmouseover = function () { row.style.background = 'rgba(255,255,255,0.08)'; };
							row.onmouseout = function () { row.style.background = 'transparent'; };
							const txt = document.createElement('span');
							txt.style.cssText = 'font-size:11px;color:#fc6;';
							txt.textContent = nome + ' (' + alId + ')';
							const btnRem = document.createElement('span');
							btnRem.style.cssText = 'cursor:pointer;color:#c0392b;font-size:13px;font-weight:bold;padding:0 4px;';
							btnRem.textContent = '\u2716';
							btnRem.title = 'Remover';
							btnRem.onclick = (function (idx) {
								return function (e) {
									e.stopPropagation();
									cfg.aliancasSelecionadas.splice(idx, 1);
									salvarConfig(cfg);
									renderizarListaAliancas();
								};
							})(i);
							row.appendChild(txt);
							row.appendChild(btnRem);
							listaEl.appendChild(row);
						}
					}
					conteudoAlvos.appendChild(listaEl);
				}

				btnAdicAli.onclick = function () {
					if (!aliSelecionada) { uw.HumanMessage.error('Selecione uma aliança da lista'); return; }
					if (!cfg.aliancasSelecionadas) cfg.aliancasSelecionadas = [];
					if (cfg.aliancasSelecionadas.indexOf(String(aliSelecionada.id)) !== -1) { uw.HumanMessage.error('Aliança já está na lista'); return; }
					cfg.aliancasSelecionadas.push(String(aliSelecionada.id));
					salvarConfig(cfg);
					inputAli.value = '';
					aliSelecionada = null;
					dropdown.style.display = 'none';
					renderizarListaAliancas();
					uw.HumanMessage.success('Aliança adicionada');
				};

				renderizarListaAliancas();
			}
		}

		tabFiltro.onclick = function () {
			cfg.modoEnvio = 'filtro';
			salvarConfig(cfg);
			tabFiltro.style.borderColor = '#d4a017';
			tabFiltro.style.background = '#3a2a10';
			tabFiltro.style.color = '#fc6';
			tabAlianca.style.borderColor = '#555';
			tabAlianca.style.background = '#1a1a1a';
			tabAlianca.style.color = '#888';
			renderizarConteudoAlvos();
		};

		tabAlianca.onclick = function () {
			cfg.modoEnvio = 'alianca';
			salvarConfig(cfg);
			tabAlianca.style.borderColor = '#d4a017';
			tabAlianca.style.background = '#3a2a10';
			tabAlianca.style.color = '#fc6';
			tabFiltro.style.borderColor = '#555';
			tabFiltro.style.background = '#1a1a1a';
			tabFiltro.style.color = '#888';
			renderizarConteudoAlvos();
		};

		renderizarConteudoAlvos();
		secAlvos.appendChild(conteudoAlvos);

		colAlvos.appendChild(secAlvos);
		colunas.appendChild(colTerra);
		colunas.appendChild(colNaval);
		colunas.appendChild(colAlvos);
		box.appendChild(colunas);

		const colunas2 = document.createElement('div');
		colunas2.style.cssText = 'display:flex;gap:16px;margin-bottom:12px;';

		const colSeg = document.createElement('div');
		colSeg.style.cssText = 'flex:1;min-width:0;';

		const secSeg = document.createElement('div');
		secSeg.style.cssText = 'margin-bottom:0;';
		const cabSeg = document.createElement('div');
		cabSeg.style.cssText = 'font-size:13px;font-weight:bold;color:#d4a017;margin-bottom:4px;padding-bottom:4px;border-bottom:1px solid rgba(139,105,20,0.4);';
		cabSeg.textContent = 'Outros';
		secSeg.appendChild(cabSeg);

		function criarOpcaoSeguranca(titulo, descricao, chaveCfg, valorAtual, extras, recomendado) {
			const row = document.createElement('div');
			row.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;margin:8px 0;padding:6px;border-radius:4px;cursor:pointer;';
			row.onmouseover = function () { row.style.background = 'rgba(255,255,255,0.08)'; };
			row.onmouseout = function () { row.style.background = 'transparent'; };

			const info = document.createElement('div');
			info.style.cssText = 'flex:1;margin-right:10px;text-align:left;';
			const tit = document.createElement('div');
			tit.style.cssText = 'font-size:12px;font-weight:bold;color:#fc6;margin-bottom:2px;display:flex;align-items:center;gap:6px;';
			const titTexto = document.createElement('span');
			titTexto.textContent = titulo;
			tit.appendChild(titTexto);
			if (recomendado) {
				const badge = document.createElement('span');
				badge.style.cssText = 'font-size:9px;font-weight:normal;color:#2ecc71;border:1px solid #2ecc71;border-radius:3px;padding:0 4px;line-height:1.4;';
				badge.textContent = 'Recomendado';
				tit.appendChild(badge);
			}
			const desc = document.createElement('div');
			desc.style.cssText = 'font-size:10px;color:#aaa;line-height:1.3;';
			desc.textContent = descricao;
			info.appendChild(tit);
			info.appendChild(desc);
			if (extras) info.appendChild(extras);

			const cb = document.createElement('div');
			cb.style.cssText = 'width:16px;height:16px;border:2px solid #8b6914;border-radius:3px;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px;' + (valorAtual ? 'background:#4CAF50;border-color:#4CAF50;' : 'background:#1a1a1a;');
			const icon = document.createElement('div');
			icon.style.cssText = 'color:white;font-size:11px;font-weight:bold;line-height:1;' + (valorAtual ? '' : 'display:none;');
			icon.textContent = '\u2713';
			cb.appendChild(icon);

			row.appendChild(info);
			row.appendChild(cb);
			row.onclick = function () {
				cfg[chaveCfg] = !cfg[chaveCfg];
				cb.style.background = cfg[chaveCfg] ? '#4CAF50' : '#1a1a1a';
				cb.style.borderColor = cfg[chaveCfg] ? '#4CAF50' : '#8b6914';
				icon.style.display = cfg[chaveCfg] ? '' : 'none';
				salvarConfig(cfg);
			};
			return row;
		}

		const btnLimpar = document.createElement('div');
		const listaNegra = obterListaNegra();
		const totalLN = Object.keys(listaNegra).length;
		btnLimpar.style.cssText = 'cursor:pointer;padding:3px 8px;background:#c0392b;border-radius:3px;font-size:10px;font-weight:bold;color:#fff;margin-top:4px;display:inline-block;';
		btnLimpar.textContent = 'Limpar Lista' + (totalLN > 0 ? ' (' + totalLN + ')' : '');
		btnLimpar.onmouseover = function () { btnLimpar.style.background = '#e74c3c'; };
		btnLimpar.onmouseout = function () { btnLimpar.style.background = '#c0392b'; };
		btnLimpar.onclick = function (e) {
			e.stopPropagation();
			salvarListaNegra({});
			btnLimpar.textContent = 'Limpar Lista (0)';
			btnLimpar.style.background = '#555';
			btnLimpar.style.cursor = 'default';
			btnLimpar.onmouseover = null;
			btnLimpar.onmouseout = null;
			uw.HumanMessage.success('Lista negra limpa');
		};

		secSeg.appendChild(criarOpcaoSeguranca(
			'Lista Negra',
			'Bloqueia cidades que recusaram apoio por 24h.',
			'listaNegraAtiva', cfg.listaNegraAtiva, btnLimpar, true
		));

		secSeg.appendChild(criarOpcaoSeguranca(
			'Overlay de Envio',
			'Exibe painel sobre o jogo durante envio.',
			'overlayAtivo', cfg.overlayAtivo, null, true
		));

		const linhaCor = document.createElement('div');
		linhaCor.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin:8px 0;padding:6px;border-radius:4px;';
		const txtCor = document.createElement('span');
		txtCor.style.cssText = 'font-size:11px;color:#fc6;';
		txtCor.textContent = 'Cor do Escudo';
		const selectCor = document.createElement('select');
		selectCor.style.cssText = 'padding:4px 6px;background:#1a1a1a;border:1px solid #8b6914;border-radius:3px;color:#fc6;font-size:12px;cursor:pointer;';
		const coresOpcoes = [
			{ label: 'Azul', hue: 210 },
			{ label: 'Verde', hue: 90 },
			{ label: 'Vermelho', hue: 330 },
			{ label: 'Roxo', hue: 240 },
			{ label: 'Amarelo', hue: 30 }
		];
		const hueAtual = typeof cfg.corEscudo !== 'undefined' ? cfg.corEscudo : 210;
		coresOpcoes.forEach(function (c) {
			const opt = document.createElement('option');
			opt.value = c.hue;
			opt.textContent = c.label;
			if (c.hue === hueAtual) opt.selected = true;
			selectCor.appendChild(opt);
		});
		selectCor.onchange = function () {
			cfg.corEscudo = parseInt(selectCor.value);
			salvarConfig(cfg);
			atualizarCorEscudos();
		};
		linhaCor.appendChild(txtCor);
		linhaCor.appendChild(selectCor);
		secSeg.appendChild(linhaCor);

		colSeg.appendChild(secSeg);
		colunas2.appendChild(colSeg);

		const colIlhas = document.createElement('div');
		colIlhas.style.cssText = 'flex:1;min-width:0;';

		const secIlhas = document.createElement('div');
		secIlhas.style.cssText = 'margin-bottom:0;';
		const cabIlhas = document.createElement('div');
		cabIlhas.style.cssText = 'font-size:13px;font-weight:bold;color:#d4a017;margin-bottom:4px;padding-bottom:4px;border-bottom:1px solid rgba(139,105,20,0.4);';
		cabIlhas.textContent = 'Ignorar Ilhas';
		secIlhas.appendChild(cabIlhas);

		const descIlhas = document.createElement('div');
		descIlhas.style.cssText = 'font-size:11px;color:#aaa;margin-bottom:6px;line-height:1.4;';
		descIlhas.textContent = 'Ilhas ignoradas não recebem sentinelas.';
		secIlhas.appendChild(descIlhas);

		const linhaIlha = document.createElement('div');
		linhaIlha.style.cssText = 'display:flex;gap:4px;margin-bottom:6px;';
		const inputIlhaX = document.createElement('input');
		inputIlhaX.type = 'text';
		inputIlhaX.placeholder = 'X';
		inputIlhaX.style.cssText = 'width:40px;padding:4px 6px;background:#1a1a1a;border:1px solid #8b6914;border-radius:3px;color:#fc6;font-size:12px;font-family:Arial,sans-serif;';
		const inputIlhaY = document.createElement('input');
		inputIlhaY.type = 'text';
		inputIlhaY.placeholder = 'Y';
		inputIlhaY.style.cssText = 'width:40px;padding:4px 6px;background:#1a1a1a;border:1px solid #8b6914;border-radius:3px;color:#fc6;font-size:12px;font-family:Arial,sans-serif;';
		const btnAdicIlha = document.createElement('div');
		btnAdicIlha.style.cssText = 'cursor:pointer;padding:4px 8px;background:#8b6914;border-radius:3px;font-size:11px;font-weight:bold;color:#fff;';
		btnAdicIlha.textContent = 'Adicionar';
		btnAdicIlha.onmouseover = function () { btnAdicIlha.style.background = '#a67c1a'; };
		btnAdicIlha.onmouseout = function () { btnAdicIlha.style.background = '#8b6914'; };
		const btnUsarCidade = document.createElement('div');
		btnUsarCidade.style.cssText = 'cursor:pointer;padding:4px 8px;background:#2c3e50;border-radius:3px;font-size:11px;font-weight:bold;color:#fff;';
		btnUsarCidade.textContent = 'Usar minha cidade';
		btnUsarCidade.onmouseover = function () { btnUsarCidade.style.background = '#34495e'; };
		btnUsarCidade.onmouseout = function () { btnUsarCidade.style.background = '#2c3e50'; };
		linhaIlha.appendChild(inputIlhaX);
		linhaIlha.appendChild(inputIlhaY);
		linhaIlha.appendChild(btnAdicIlha);
		linhaIlha.appendChild(btnUsarCidade);
		secIlhas.appendChild(linhaIlha);

		function renderizarListaIlhas() {
			const antiga = secIlhas.querySelector('.lista-ilhas');
			if (antiga) antiga.remove();
			const listaIlhas = document.createElement('div');
			listaIlhas.className = 'lista-ilhas';
			listaIlhas.style.cssText = 'max-height:200px;overflow-y:auto;';
			if (!cfg.ilhasIgnoradas || cfg.ilhasIgnoradas.length === 0) {
				const vazio = document.createElement('div');
				vazio.style.cssText = 'font-size:11px;color:#666;font-style:italic;';
				vazio.textContent = 'Nenhuma ilha ignorada.';
				listaIlhas.appendChild(vazio);
			} else {
				for (let i = 0; i < cfg.ilhasIgnoradas.length; i++) {
					const ilha = cfg.ilhasIgnoradas[i];
					const row = document.createElement('div');
					row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:3px 6px;border-radius:3px;margin:2px 0;';
					row.onmouseover = function () { row.style.background = 'rgba(255,255,255,0.08)'; };
					row.onmouseout = function () { row.style.background = 'transparent'; };
					const txt = document.createElement('span');
					txt.style.cssText = 'font-size:11px;color:#fc6;';
					txt.textContent = ilha.x + '/' + ilha.y;
					const btnRem = document.createElement('span');
					btnRem.style.cssText = 'cursor:pointer;color:#c0392b;font-size:13px;font-weight:bold;padding:0 4px;';
					btnRem.textContent = '\u2716';
					btnRem.title = 'Remover';
					btnRem.onclick = function (e) {
						e.stopPropagation();
						cfg.ilhasIgnoradas.splice(i, 1);
						salvarConfig(cfg);
						renderizarListaIlhas();
					};
					row.appendChild(txt);
					row.appendChild(btnRem);
					listaIlhas.appendChild(row);
				}
			}
			secIlhas.appendChild(listaIlhas);
		}

		btnAdicIlha.onclick = function () {
			const x = inputIlhaX.value.trim();
			const y = inputIlhaY.value.trim();
			if (!x || !y) { uw.HumanMessage.error('Insira as coordenadas X e Y'); return; }
			if (!cfg.ilhasIgnoradas) cfg.ilhasIgnoradas = [];
			const duplicada = cfg.ilhasIgnoradas.some(function (h) { return String(h.x) === String(x) && String(h.y) === String(y); });
			if (duplicada) { uw.HumanMessage.error('Ilha já está na lista'); return; }
			cfg.ilhasIgnoradas.push({ x: parseInt(x), y: parseInt(y) });
			salvarConfig(cfg);
			inputIlhaX.value = '';
			inputIlhaY.value = '';
			renderizarListaIlhas();
			uw.HumanMessage.success('Ilha adicionada à lista de ignoradas');
		};

		btnUsarCidade.onclick = function () {
			const cidades = [];
			for (let id in uw.ITowns.towns) {
				const c = uw.ITowns.towns[id];
				let nome = '';
				try { nome = c.get('name') || ''; } catch (e) {}
				if (!nome) {
					for (let i = 0; i < lista_cidades.length; i++) {
						if (String(lista_cidades[i][0]) === String(id)) { nome = lista_cidades[i][2] || 'Cidade ' + id; break; }
					}
				}
				cidades.push({ id: id, nome: nome || 'Cidade ' + id, ilhaX: c.getIslandCoordinateX(), ilhaY: c.getIslandCoordinateY() });
			}
			if (cidades.length === 0) { uw.HumanMessage.error('Nenhuma cidade encontrada'); return; }

			const selModal = document.createElement('div');
			selModal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:100001;display:flex;align-items:center;justify-content:center;';
			const selOverlay = document.createElement('div');
			selOverlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);';
			const selBox = document.createElement('div');
			selBox.style.cssText = 'position:relative;background:#2a1a0e;border:2px solid #8b6914;border-radius:8px;padding:20px;min-width:300px;max-height:60vh;display:flex;flex-direction:column;color:#fc6;font-family:Arial,sans-serif;font-size:13px;';
			const selTitulo = document.createElement('div');
			selTitulo.style.cssText = 'font-size:14px;font-weight:bold;margin-bottom:10px;text-align:center;';
			selTitulo.textContent = 'Selecionar Cidade';
			selBox.appendChild(selTitulo);

			const campoBusca = document.createElement('input');
			campoBusca.type = 'text';
			campoBusca.placeholder = 'Buscar cidade...';
			campoBusca.style.cssText = 'width:100%;padding:6px 8px;background:#1a1a1a;border:1px solid #8b6914;border-radius:4px;color:#fc6;font-size:12px;font-family:Arial,sans-serif;margin-bottom:10px;';
			selBox.appendChild(campoBusca);

			const listaContainer = document.createElement('div');
			listaContainer.style.cssText = 'overflow-y:auto;flex:1;max-height:40vh;';
			selBox.appendChild(listaContainer);

			function renderizarCidades(filtro) {
				listaContainer.innerHTML = '';
				const filtradas = filtro ? cidades.filter(function (c) { return c.nome.toLowerCase().indexOf(filtro.toLowerCase()) !== -1; }) : cidades;
				for (let i = 0; i < filtradas.length; i++) {
					const c = filtradas[i];
					const item = document.createElement('div');
					item.style.cssText = 'padding:6px 8px;cursor:pointer;border-radius:3px;margin:2px 0;font-size:12px;';
					item.onmouseover = function () { item.style.background = 'rgba(255,255,255,0.1)'; };
					item.onmouseout = function () { item.style.background = 'transparent'; };
					item.textContent = c.nome + ' (' + c.ilhaX + '/' + c.ilhaY + ')';
					item.onclick = function () {
						inputIlhaX.value = c.ilhaX;
						inputIlhaY.value = c.ilhaY;
						selModal.remove();
					};
					listaContainer.appendChild(item);
				}
			}

			campoBusca.oninput = function () { renderizarCidades(campoBusca.value); };
			renderizarCidades('');

			const selFechar = document.createElement('div');
			selFechar.style.cssText = 'margin-top:10px;cursor:pointer;padding:6px 16px;background:#555;border-radius:4px;font-size:12px;font-weight:bold;color:#fff;text-align:center;';
			selFechar.textContent = 'Cancelar';
			selFechar.onmouseover = function () { selFechar.style.background = '#777'; };
			selFechar.onmouseout = function () { selFechar.style.background = '#555'; };
			selFechar.onclick = function () { selModal.remove(); };
			selBox.appendChild(selFechar);

			selModal.appendChild(selOverlay);
			selModal.appendChild(selBox);
			document.body.appendChild(selModal);
			selOverlay.onclick = function () { selModal.remove(); };
			campoBusca.focus();
		};

		renderizarListaIlhas();
		colIlhas.appendChild(secIlhas);
		colunas2.appendChild(colIlhas);
		box.appendChild(colunas2);

		const btnFechar = document.createElement('div');
		btnFechar.style.cssText = 'margin-top:10px;cursor:pointer;padding:6px 16px;background:#8b6914;border-radius:4px;font-size:12px;font-weight:bold;color:#fff;';
		btnFechar.textContent = 'Fechar';
		btnFechar.onclick = function () { modal.remove(); };
		btnFechar.onmouseover = function () { btnFechar.style.background = '#a67c1a'; };
		btnFechar.onmouseout = function () { btnFechar.style.background = '#8b6914'; };

		const btnRestaurar = document.createElement('div');
		btnRestaurar.style.cssText = 'margin-top:10px;cursor:pointer;padding:6px 16px;background:#c0392b;border-radius:4px;font-size:12px;font-weight:bold;color:#fff;';
		btnRestaurar.textContent = 'Restaurar Padr\u00f5es';
		btnRestaurar.onmouseover = function () { btnRestaurar.style.background = '#e74c3c'; };
		btnRestaurar.onmouseout = function () { btnRestaurar.style.background = '#c0392b'; };
		btnRestaurar.onclick = function (e) {
			e.stopPropagation();
			const confirmModal = document.createElement('div');
			confirmModal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:100000;display:flex;align-items:center;justify-content:center;';
			const confirmOverlay = document.createElement('div');
			confirmOverlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);';
			const confirmBox = document.createElement('div');
			confirmBox.style.cssText = 'position:relative;background:#2a1a0e;border:2px solid #c0392b;border-radius:8px;padding:20px;max-width:340px;color:#fc6;font-family:Arial,sans-serif;font-size:13px;text-align:center;';
			const confirmTitulo = document.createElement('div');
			confirmTitulo.style.cssText = 'font-size:14px;font-weight:bold;margin-bottom:10px;color:#e74c3c;';
			confirmTitulo.textContent = 'Restaurar Padr\u00f5es?';
			const confirmTxt = document.createElement('div');
			confirmTxt.style.cssText = 'font-size:12px;color:#aaa;line-height:1.5;margin-bottom:16px;';
			confirmTxt.innerHTML = 'Isso vai:<br>\u2022 Restaurar todas as unidades terrestres e navais para o padr\u00e3o<br>\u2022 Ativar Lista Negra e Overlay de Envio<br><br>Suas configura\u00e7\u00f5es atuais ser\u00e3o perdidas.';
			const confirmBtns = document.createElement('div');
			confirmBtns.style.cssText = 'display:flex;gap:10px;justify-content:center;';
			const btnSim = document.createElement('div');
			btnSim.style.cssText = 'cursor:pointer;padding:6px 16px;background:#c0392b;border-radius:4px;font-size:12px;font-weight:bold;color:#fff;';
			btnSim.textContent = 'Sim, restaurar';
			btnSim.onmouseover = function () { btnSim.style.background = '#e74c3c'; };
			btnSim.onmouseout = function () { btnSim.style.background = '#c0392b'; };
			btnSim.onclick = function () {
				const terra = {};
				const naval = {};
				for (let i = 0; i < UNIDADES_TERRA.length; i++) terra[UNIDADES_TERRA[i].chave] = PADRAO_TERRA[UNIDADES_TERRA[i].chave];
				for (let i = 0; i < UNIDADES_NAVAL.length; i++) naval[UNIDADES_NAVAL[i].chave] = PADRAO_NAVAL[UNIDADES_NAVAL[i].chave];
				salvarConfig({ terra: terra, naval: naval, ordemTerra: PADRAO_ORDEM_TERRA.slice(), ordemNaval: PADRAO_ORDEM_NAVAL.slice(), listaNegraAtiva: true, overlayAtivo: true, enviarAliados: true, enviarSemAlianca: true, enviarFantasmas: true, enviarInimigos: false, ilhasIgnoradas: [], modoEnvio: 'filtro', aliancasSelecionadas: [], corEscudo: 210 });
				confirmModal.remove();
				modal.remove();
				uw.HumanMessage.success('Configura\u00e7\u00f5es restauradas');
				abrirConfig();
			};
			const btnNao = document.createElement('div');
			btnNao.style.cssText = 'cursor:pointer;padding:6px 16px;background:#555;border-radius:4px;font-size:12px;font-weight:bold;color:#fff;';
			btnNao.textContent = 'Cancelar';
			btnNao.onmouseover = function () { btnNao.style.background = '#777'; };
			btnNao.onmouseout = function () { btnNao.style.background = '#555'; };
			btnNao.onclick = function () { confirmModal.remove(); };
			confirmBtns.appendChild(btnSim);
			confirmBtns.appendChild(btnNao);
			confirmBox.appendChild(confirmTitulo);
			confirmBox.appendChild(confirmTxt);
			confirmBox.appendChild(confirmBtns);
			confirmModal.appendChild(confirmOverlay);
			confirmModal.appendChild(confirmBox);
			document.body.appendChild(confirmModal);
			confirmOverlay.onclick = function () { confirmModal.remove(); };
		};

		const botoes = document.createElement('div');
		botoes.style.cssText = 'display:flex;gap:10px;justify-content:center;';
		botoes.appendChild(btnRestaurar);
		botoes.appendChild(btnFechar);
		box.appendChild(botoes);

		modal.appendChild(overlay);
		modal.appendChild(box);
		document.body.appendChild(modal);
	}

	// ========================
	// Sentinela Global (helpers)
	// ========================

	let cancelarEnvio = false;
	let pendingResolve = null;
	let geracaoEnvio = 0;

	function delay(ms) {
		return new Promise(function (r) { setTimeout(r, ms); });
	}

	function enviarSentinelaPromise(unidade, destinoId, origemId) {
		return new Promise(function (resolve) {
			geracaoEnvio++;
			const minhaGeracao = geracaoEnvio;
			if (pendingResolve) pendingResolve(null);
			pendingResolve = { resolve: function (resp) {
				pendingResolve = null;
				resolve(resp);
			}, geracao: minhaGeracao };
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

	/* Retorna a unidade disponível para uma cidade específica (respeita config) */
	function obterUnidadeParaCidade(cidadeId, cfg) {
		if (!cfg) cfg = carregarConfig();
		const cidade = uw.ITowns.towns[cidadeId];
		if (!cidade) return null;
		const unidades = cidade.getLandUnits();
		const ordem = cfg.ordemTerra || PADRAO_ORDEM_TERRA;
		for (let i = 0; i < ordem.length; i++) {
			const k = ordem[i];
			if (cfg.terra[k] && unidades[k] > 0) return k;
		}
		return null;
	}

	/* Retorna a unidade naval disponível para uma cidade específica (respeita config) */
	function obterUnidadeNaval(cidadeId, cfg) {
		if (!cfg) cfg = carregarConfig();
		const cidade = uw.ITowns.towns[cidadeId];
		if (!cidade) return null;
		const unidades = cidade.units();
		if (!unidades) return null;
		const ordem = cfg.ordemNaval || PADRAO_ORDEM_NAVAL;
		for (let i = 0; i < ordem.length; i++) {
			const k = ordem[i];
			if (cfg.naval[k] && uw.GameData.units[k] && uw.GameData.units[k].is_naval && unidades[k] > 0) return k;
		}
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

	let _ajxTimer = null;
	$(document).ajaxComplete(function () {
		if (_ajxTimer) return;
		_ajxTimer = setTimeout(function () { _ajxTimer = null; }, 500);
		injetarBotoesIlha();
	});

	function injetarBotoesIlha() {
		let wnds = GPWindowMgr.getOpen(Layout.wnd.TYPE_ISLAND);
		for (let e in wnds) {
			if (wnds.hasOwnProperty(e)) {
				let wndid = wnds[e].getID();
				let wnd_window = document.getElementById(`gpwnd_${wndid}`);
				if (!wnd_window) continue;

				let btn1 = wnd_window.getElementsByClassName('a1')[0];
				if (btn1) continue;

				let coord = $(`#gpwnd_${wndid}`).find('.islandinfo_coords').text();
				const type = '[0-9][0-9]*/[0-9][0-9]*';
				const match = coord.match(type);
				if (!match) continue;
				let coordX = match[0].split('/')[0];
				let coordY = match[0].split('/')[1];

				$($(`#gpwnd_${wndid}`).find('.island_info_wrapper')).append(
					'<div class="button_new a1" title="Envia 1 sentinela para cada cidade aliada na ilha"><div class="left"></div><div class="right"></div><div class="caption js-caption"> Enviar Sentinelas <div class="effect js-effect"></div></div></div>'
				);
				$($(`#gpwnd_${wndid}`).find('.island_info_wrapper')).append(
					'<div class="button_new a2" style="margin-left:5px;" title="Envia sentinelas para todas as ilhas de uma vez"><div class="left"></div><div class="right"></div><div class="caption js-caption"> Sentinela Global <div class="effect js-effect"></div></div></div>'
				);
				$($(`#gpwnd_${wndid}`).find('.island_info_wrapper')).append(
					'<div class="button_new a3" style="margin-left:5px;" title="Alterar configura\u00e7\u00f5es do envio de sentinelas"><div class="left"></div><div class="right"></div><div class="caption js-caption"> \u2699 <div class="effect js-effect"></div></div></div>'
				);

				const jaIgnorada = ilhaIgnorada(coordX, coordY);
				const btnIgnorar = $('<div class="button_new a4" style="margin-left:5px;display:inline-block;" title="' + (jaIgnorada ? 'Remover ilha da lista de ignoradas' : 'Adicionar ilha à lista de ignoradas') + '"><div class="left"></div><div class="right"></div><div class="caption js-caption">' + (jaIgnorada ? ' Ilha Ignorada \u2713 ' : ' Ignorar Ilha ') + '<div class="effect js-effect"></div></div></div>');
				$($(`#gpwnd_${wndid}`).find('#island_bbcode_id')).after(btnIgnorar);
				btnIgnorar.on('click', function () {
					const cfg = carregarConfig();
					if (!cfg.ilhasIgnoradas) cfg.ilhasIgnoradas = [];
					const idx = cfg.ilhasIgnoradas.findIndex(function (h) { return String(h.x) === String(coordX) && String(h.y) === String(coordY); });
					if (idx >= 0) {
						cfg.ilhasIgnoradas.splice(idx, 1);
						btnIgnorar.find('.caption').html(' Ignorar Ilha <div class="effect js-effect"></div></div>');
						btnIgnorar.attr('title', 'Adicionar ilha à lista de ignoradas');
						uw.HumanMessage.success('Ilha removida da lista de ignoradas');
					} else {
						cfg.ilhasIgnoradas.push({ x: parseInt(coordX), y: parseInt(coordY) });
						btnIgnorar.find('.caption').html(' Ilha Ignorada \u2713 <div class="effect js-effect"></div></div>');
						btnIgnorar.attr('title', 'Remover ilha da lista de ignoradas');
						uw.HumanMessage.success('Ilha adicionada à lista de ignoradas');
					}
					salvarConfig(cfg);
				});
				$(`#gpwnd_${wndid}`).on('click', '.a1', function () {
					if (ilhaIgnorada(coordX, coordY)) {
						uw.HumanMessage.error('Esta ilha está na lista de ignoradas');
						return;
					}
					const cfg = carregarConfig();
					let lista = obterCidades(coordX, coordY);
					let cidades_jogador = jogadorTemCidades(lista);
					for (let i = 0; i < cidades_jogador.length; i++) {
						lista = lista.filter((item) => item !== cidades_jogador[i]);
						lista = removerSentinela(lista, 1, cidades_jogador[i]);
						lista = removerSuporte(lista, cidades_jogador[i]);
					}
					lista = filtrarPorTipo(lista);
					const cidadesJogadorIds = cidades_jogador.map(String);
					let enviosFeitos = 0;
					for (let i = 0; i < lista.length; i++) {
						if (temSentinela(lista[i])) continue;
						if (estaNaListaNegra(lista[i])) continue;
						enviosFeitos++;
						const idx = i;
						setTimeout(() => {
							if (temSentinela(lista[idx])) return;
							if (temSuporteACaminho(lista[idx])) return;
							if (estaNaListaNegra(lista[idx])) return;
							for (let c = 0; c < cidadesJogadorIds.length; c++) {
								const cid = cidadesJogadorIds[c];
								if (temSentinelaDe(cid, lista[idx])) continue;
								const unitTerra = obterUnidadeParaCidade(cid, cfg);
								if (unitTerra) { enviarSentinela(unitTerra, lista[idx], cid); return; }
								const unitNaval = obterUnidadeNaval(cid, cfg);
								if (unitNaval) { enviarSentinela(unitNaval, lista[idx], cid); return; }
							}
						}, i * 500);
					}
					if (enviosFeitos === 0) {
						uw.HumanMessage.error('Nenhum alvo encontrado nesta ilha');
					}
				});
				$(`#gpwnd_${wndid}`).on('click', '.a3', function () {
					abrirConfig();
				});
				$(`#gpwnd_${wndid}`).on('click', '.a2', function () {
					const cfg = carregarConfig();
					enviarSentinelaGlobal(cfg);
				});
			}
		}
	}

	const _ilhasObserver = new MutationObserver(function () {
		injetarBotoesIlha();
	});
	_ilhasObserver.observe(document.body, { childList: true, subtree: true });

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
					if (targetId && pendingResolve && pendingResolve.geracao === geracaoEnvio) {
						adicionarListaNegra(targetId);
					}
				}
			} catch (e) {}
			if (pendingResolve && pendingResolve.geracao === geracaoEnvio) {
				var resolver = pendingResolve.resolve;
				setTimeout(function () { resolver({ success: !teveErro }); }, 0);
			}
		}
	});

	// ========================
	// Janela de progresso (única, muda posição conforme overlay)
	// ========================

	function criarJanelaProgresso(usarOverlay) {
		removerJanelaProgresso();
		cancelarEnvio = false;

		const ov = document.createElement('div');
		ov.id = 'p1';

		if (usarOverlay) {
			ov.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:99998;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);';
		} else {
			ov.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:99998;pointer-events:none;';
		}

		const painel = document.createElement('div');
		if (usarOverlay) {
			painel.style.cssText = 'pointer-events:auto;background:#2a1a0e;border:2px solid #8b6914;border-radius:10px;padding:24px 32px;text-align:center;color:#fc6;font-family:Arial,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,0.7);min-width:300px;';
		} else {
			painel.style.cssText = 'pointer-events:auto;position:fixed;bottom:20px;right:60px;background:rgba(0,0,0,0.85);color:white;padding:10px 14px;border-radius:6px;font-family:Arial,sans-serif;font-size:12px;min-width:220px;box-shadow:0 4px 12px rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.1);';
		}

		const titulo = document.createElement('div');
		titulo.id = 'p2';
		titulo.style.cssText = usarOverlay ? 'font-size:16px;font-weight:bold;margin-bottom:8px;' : 'margin-bottom:6px;font-weight:bold;font-size:13px;';
		titulo.textContent = 'Sentinela Global';
		painel.appendChild(titulo);

		const sub = document.createElement('div');
		sub.id = 'p3';
		sub.style.cssText = usarOverlay ? 'font-size:12px;color:#aaa;margin-bottom:12px;' : 'margin-bottom:6px;';
		sub.textContent = 'Preparando...';
		painel.appendChild(sub);

		const barraContainer = document.createElement('div');
		barraContainer.style.cssText = 'background:#333;border-radius:3px;overflow:hidden;height:16px;margin-bottom:8px;';
		const barraFill = document.createElement('div');
		barraFill.id = 'p4';
		barraFill.style.cssText = 'background:linear-gradient(90deg,#4CAF50,#45a049);height:100%;width:0%;transition:width 0.3s ease;';
		barraContainer.appendChild(barraFill);
		painel.appendChild(barraContainer);

		const contador = document.createElement('div');
		contador.id = 'p5';
		contador.style.cssText = 'font-size:11px;color:#aaa;text-align:right;margin-bottom:8px;';
		contador.textContent = '0/0';
		painel.appendChild(contador);

		const btn = document.createElement('div');
		btn.style.cssText = 'cursor:pointer;padding:' + (usarOverlay ? '8px 24px' : '4px 10px') + ';background:#c0392b;border-radius:3px;font-size:' + (usarOverlay ? '13px' : '11px') + ';font-weight:bold;color:#fff;display:inline-block;text-align:center;';
		btn.textContent = 'Cancelar';
		btn.onmouseover = function () { btn.style.background = '#e74c3c'; };
		btn.onmouseout = function () { btn.style.background = '#c0392b'; };
		btn.onclick = function () {
			cancelarEnvio = true;
			removerJanelaProgresso();
			uw.HumanMessage.error('Envio cancelado');
		};
		painel.appendChild(btn);

		ov.appendChild(painel);
		document.body.appendChild(ov);
	}

	function atualizarTituloProgresso(titulo) {
		const el = document.getElementById('p2');
		if (el) el.textContent = titulo;
	}

	function atualizarTextoProgresso(texto) {
		const el = document.getElementById('p3');
		if (el) el.textContent = texto;
	}

	function removerJanelaProgresso() {
		const ov = document.getElementById('p1');
		if (ov) ov.remove();
	}

	function atualizarBarraProgresso(enviados, total) {
		const texto = document.getElementById('p3');
		const barra = document.getElementById('p4');
		const contador = document.getElementById('p5');
		if (texto) texto.textContent = enviados >= total ? 'Concluído!' : 'Enviando sentinelas...';
		if (barra) barra.style.width = (total > 0 ? (enviados / total) * 100 : 0) + '%';
		if (contador) contador.textContent = enviados + '/' + total;
	}

	function enviarSentinelaGlobal(cfg) {
		if (!cfg) cfg = carregarConfig();
		const cidadesJogador = [];
		for (let id in uw.ITowns.towns) {
			cidadesJogador.push(uw.ITowns.towns[id]);
		}
		if (cidadesJogador.length === 0) {
			uw.HumanMessage.error('Nenhuma cidade encontrada');
			return;
		}

		cidadesJogador.sort(function (a, b) {
			const nomeA = (a.get('name') || '').toLowerCase();
			const nomeB = (b.get('name') || '').toLowerCase();
			return nomeA.localeCompare(nomeB);
		});

		const ilhas = {};
		const ordemIlhasChaves = [];
		for (let i = 0; i < cidadesJogador.length; i++) {
			const cidade = cidadesJogador[i];
			const ilhaX = cidade.getIslandCoordinateX();
			const ilhaY = cidade.getIslandCoordinateY();
			const chaveIlha = ilhaX + '_' + ilhaY;
			if (!ilhas[chaveIlha]) {
				ilhas[chaveIlha] = [];
				ordemIlhasChaves.push(chaveIlha);
			}
			ilhas[chaveIlha].push(cidade);
		}

		for (let i = 0; i < ordemIlhasChaves.length; i++) {
			ilhas[ordemIlhasChaves[i]].sort(function (a, b) {
				const nomeA = (a.get('name') || '').toLowerCase();
				const nomeB = (b.get('name') || '').toLowerCase();
				return nomeA.localeCompare(nomeB);
			});
		}

		const chavesIlha = ordemIlhasChaves;
		const filaPorIlha = {};
		const ordemIlhas = [];
		let indiceIlha = 0;
		dsDebug('Total de ilhas para processar: ' + chavesIlha.length);

		const usarOverlay = cfg.overlayAtivo;
		criarJanelaProgresso(usarOverlay);
		atualizarTextoProgresso('Preparando ilhas... 0/' + chavesIlha.length);
		atualizarBarraProgresso(0, chavesIlha.length);

		function processarProximaIhla() {
			try {
				if (indiceIlha >= chavesIlha.length) {
					dsDebug('Todas as ilhas processadas');
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

				if (ilhaIgnorada(ilhaX, ilhaY)) {
					dsDebug('Ilha ignorada: ' + chaveIlha);
					atualizarTextoProgresso('Preparando ilhas... ' + indiceIlha + '/' + chavesIlha.length);
					atualizarBarraProgresso(indiceIlha, chavesIlha.length);
					setTimeout(processarProximaIhla, 25);
					return;
				}

				let todasCidadesIlha = obterCidades(ilhaX, ilhaY);
				todasCidadesIlha = filtrarPorTipo(todasCidadesIlha);

				const minhasCidades = cidadesIlha.map(function (c) { return String(c.id); });
				let cidadesAlvo = todasCidadesIlha.filter(function (id) {
					return minhasCidades.indexOf(String(id)) === -1;
				});

				const enviosIlha = [];
				const destinosAtendidos = {};
				for (let j = 0; j < cidadesIlha.length; j++) {
					const cidadeOrigem = cidadesIlha[j];
					const temTerra = obterUnidadeParaCidade(cidadeOrigem.id, cfg);
					const temNaval = obterUnidadeNaval(cidadeOrigem.id, cfg);
					if (!temTerra && !temNaval) continue;
					for (let k = 0; k < cidadesAlvo.length; k++) {
						const cidadeAlvoId = cidadesAlvo[k];
						if (destinosAtendidos[cidadeAlvoId]) continue;
						if (estaNaListaNegra(cidadeAlvoId)) continue;
						if (temSentinela(cidadeAlvoId)) continue;
						if (temSuporteACaminho(cidadeAlvoId)) continue;
						if (temSentinelaDe(cidadeOrigem.id, cidadeAlvoId)) continue;
						if (temTerra) {
							enviosIlha.push({ origem: cidadeOrigem.id, destino: cidadeAlvoId, tipo: 'terra' });
							destinosAtendidos[cidadeAlvoId] = true;
						} else if (temNaval) {
							enviosIlha.push({ origem: cidadeOrigem.id, destino: cidadeAlvoId, tipo: 'naval' });
							destinosAtendidos[cidadeAlvoId] = true;
						}
					}
				}

				if (enviosIlha.length > 0) {
					filaPorIlha[chaveIlha] = enviosIlha;
					ordemIlhas.push(chaveIlha);
				}

				atualizarTextoProgresso('Preparando ilhas... ' + indiceIlha + '/' + chavesIlha.length);
				atualizarBarraProgresso(indiceIlha, chavesIlha.length);
			} catch (e) {
				dsDebug('Erro ao processar ilha: ' + (e.message || e));
			}

			setTimeout(processarProximaIhla, 25);
		}

		async function iniciarEnvios() {
			if (ordemIlhas.length === 0) {
				uw.HumanMessage.error('Nenhuma sentinela para enviar');
				removerJanelaProgresso();
				return;
			}

			let totalEnvios = 0;
			for (let i = 0; i < ordemIlhas.length; i++) {
				totalEnvios += filaPorIlha[ordemIlhas[i]].length;
			}

			atualizarTituloProgresso('Enviando Sentinelas');
			atualizarTextoProgresso('Enviando... 0/' + totalEnvios);
			atualizarBarraProgresso(0, totalEnvios);
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
					if (temSentinela(envio.destino)) { dsDebug('Destino ' + envio.destino + ' ja tem sentinela, pulando'); continue; }
					if (temSuporteACaminho(envio.destino)) { dsDebug('Destino ' + envio.destino + ' ja tem suporte a caminho, pulando'); continue; }
					if (temSentinelaDe(envio.origem, envio.destino)) { dsDebug('Origem ' + envio.origem + ' ja enviou para ' + envio.destino + ', pulando'); continue; }
					let unidade = null;
					if (envio.tipo === 'naval') {
						unidade = obterUnidadeNaval(envio.origem, cfg);
					} else {
						unidade = obterUnidadeParaCidade(envio.origem, cfg);
					}
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
					atualizarTextoProgresso('Enviando... ' + processadas + '/' + totalEnvios);
					if (j < enviosIlha.length - 1) {
						await delay(1500 + Math.floor(Math.random() * 500) - 250);
					}
				}
			}

			setTimeout(function () {
				removerJanelaProgresso();
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

	function initSentinela() {
		aguardarJogo(function () {
			configurarIndicador();
			setTimeout(atualizarMapa, 1500);
		});
	}

	if (document.readyState === 'complete') {
		initSentinela();
	} else {
		window.addEventListener('load', initSentinela);
	}

})();
