import * as L from './logic.js';
import * as store from './store.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ROLE = ['Principal', 'Alternativa 1', 'Alternativa 2'];
let P, logs = {}, states = {}, meta = {}, view = null, undo = null, toastTimer = null, focusValue = false;

const gyms = () => (meta.gyms && meta.gyms.length ? meta.gyms : L.DEFAULT_GYMS);
const curGym = () => { const g = gyms(); return g.some(x => x.id === meta.gym) ? meta.gym : (g.some(x => x.id === L.DEFAULT_GYM) ? L.DEFAULT_GYM : g[0].id); };
const gymName = id => (gyms().find(g => g.id === id) || { name: 'Outra academia' }).name;
const now = () => new Date().toISOString();
const wo = () => L.getWorkout(P, view.week, view.type);
const lineOf = () => L.getLine(wo(), view.lineId);
const stOf = line => L.lineState(states, P.id, line);
const exName = (line, o) => P.exercises[line.options[o].ex];
const doneCount = () => Object.values(logs).filter(r => r.status === 'done' && !r.deleted).length;

async function init() {
  P = await (await fetch('program.json')).json();
  const s = await store.load();
  logs = s.logs; states = s.states; meta = s.meta;
  const t = L.resumeTarget(P, logs, states, meta.position);
  view = { week: t.week, type: t.type, lineId: null, set: 1 };
  const w = wo(); const step = t.step || { lineId: w.lines[0].id, set: 1 };
  view.lineId = step.lineId; view.set = step.set;
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
  wake();
  document.addEventListener('visibilitychange', wake);
  if (window.visualViewport) {
    const f = () => document.documentElement.style.setProperty('--kb', Math.max(0, innerHeight - visualViewport.height - visualViewport.offsetTop) + 'px');
    visualViewport.addEventListener('resize', f); visualViewport.addEventListener('scroll', f);
  }
}
async function wake() { try { if (document.visibilityState === 'visible' && navigator.wakeLock) await navigator.wakeLock.request('screen'); } catch { } }

function persistState(line) { const k = L.stateKey(P.id, line.id); return store.put('states', k, states[k]); }
function setMeta(k, v) { meta[k] = v; return store.put('meta', k, v); }
function saveLog(r) { logs[r.id] = r; return store.put('logs', r.id, r); }

function toast(text, undoFn) {
  const t = $('toast'); clearTimeout(toastTimer);
  t.innerHTML = `<span>${esc(text)}</span>${undoFn ? '<button data-act="undo">Desfazer</button>' : ''}`;
  t.classList.add('show'); undo = undoFn || null;
  toastTimer = setTimeout(() => { t.classList.remove('show'); undo = null; }, undoFn ? 7000 : 3500);
}

function go(week, type, lineId, set) {
  view.week = week; view.type = type;
  const w = wo();
  if (!lineId) {
    const step = L.nextPending(w, logs, states, P.id, null) || L.sequence(w, states, P.id)[0];
    lineId = step.lineId; set = step.set;
  }
  view.lineId = lineId; view.set = set; render(); scrollTo(0, 0);
}
function goLine(lineId) {
  const line = L.getLine(wo(), lineId), n = L.totalSets(line, stOf(line));
  let s = 1; for (let i = 1; i <= line.sets; i++) if (!L.positionDone(logs, P.id, line, i)) { s = i; break; }
  view.lineId = lineId; view.set = s; render();
}
function move(d) {
  const seq = L.sequence(wo(), states, P.id);
  let i = seq.findIndex(s => s.lineId === view.lineId && s.set === view.set);
  if (i < 0) i = 0;
  const t = seq[Math.min(seq.length - 1, Math.max(0, i + d))];
  view.lineId = t.lineId; view.set = t.set; render(); scrollTo(0, 0);
}

function currentRecord(line, opt, set) { return logs[L.logId(P.id, line.id, opt, set)]; }

function readFields() {
  const load = $('load'), val = $('val');
  const usedSug = load.dataset.sug && load.classList.contains('sug');
  const pc = L.isPC(load.value);
  return { loadText: usedSug ? load.dataset.sug : (pc ? '' : load.value), valueText: val.value };
}
function baseRecord(line, opt, set) {
  return {
    id: L.logId(P.id, line.id, opt, set), programId: P.id, week: view.week, workout: view.type, lineId: line.id, pos: line.pos,
    opt, gym: curGym(), exId: line.options[opt].ex, exName: exName(line, opt), origName: exName(line, 0), set, optional: L.isOptionalSet(line, set),
    load: null, value: null, unit: line.unit, status: 'draft', doneAt: null, updatedAt: now(), deleted: false, pass: 1
  };
}
function saveDraft() {
  const line = lineOf(), st = stOf(line), cur = currentRecord(line, st.opt, view.set);
  const load = $('load'); if (load.classList.contains('sug') && document.activeElement === load) { /* usuário digitando */ }
  const loadText = load.classList.contains('sug') || L.isPC(load.value) ? '' : load.value, valueText = $('val').value;
  const empty = loadText.trim() === '' && valueText.trim() === '';
  if (cur && cur.status === 'done') {
    saveLog({ ...cur, load: L.parseNum(loadText), value: L.parseNum(valueText), updatedAt: now() }); return;
  }
  if (empty) { if (cur && !cur.deleted) saveLog({ ...cur, deleted: true, updatedAt: now() }); return; }
  saveLog({ ...(cur || baseRecord(line, st.opt, view.set)), load: L.parseNum(loadText), value: L.parseNum(valueText), deleted: false, status: 'draft', updatedAt: now() });
}

function register() {
  const line = lineOf(), st = stOf(line), set = view.set;
  const { loadText, valueText } = readFields();
  const value = L.parseNum(valueText), load = L.parseNum(loadText);
  if (value == null) { $('valf').classList.add('err'); $('val').focus(); toast(line.unit === 's' ? 'Informe os segundos.' : 'Informe as repetições.'); return; }
  if (loadText.trim() !== '' && load == null) { $('loadf').classList.add('err'); toast('Carga inválida.'); return; }
  const prev = currentRecord(line, st.opt, set);
  const wasDone = prev && prev.status === 'done' && !prev.deleted;
  const rec = { ...(prev || baseRecord(line, st.opt, set)), load, value, deleted: false, status: 'done', updatedAt: now(), doneAt: wasDone ? prev.doneAt : now() };
  saveLog(rec);
  if (wasDone) { toast('Alteração salva.'); render(); return; }
  setMeta('position', { week: view.week, type: view.type, lineId: line.id, set });
  const next = L.nextPending(wo(), logs, states, P.id, { lineId: line.id, set });
  if (next) { view.lineId = next.lineId; view.set = next.set; focusValue = true; }
  else toast('Treino concluído!');
  render(); scrollTo(0, 0);
}
function unmark() {
  const line = lineOf(), st = stOf(line), cur = currentRecord(line, st.opt, view.set);
  if (cur && cur.status === 'done') { saveLog({ ...cur, status: 'draft', doneAt: null, updatedAt: now() }); toast('Conclusão removida; valores mantidos como rascunho.'); render(); }
}

function warmupHtml(line) {
  const g = P.general.sections[0].items, w = line.warm;
  if (w === '0') return '<p>Sem aquecimento: o músculo já foi aquecido por um exercício anterior do mesmo dia.</p>';
  const nums = w.includes('-') ? w.split('-').map(Number).filter(Boolean) : [Number(w)];
  const plural = n => n === 1 ? '1 série' : `${n} séries`;
  const items = nums.map(n => g.find(i => i.label === plural(n))).filter(Boolean);
  return `<p><b>${esc(w)} ${w === '1' ? 'série' : 'séries'} de aquecimento.</b></p>` + items.map(i => `<p>${esc(i.label)}: ${esc(i.text)}</p>`).join('') +
    `<p>${esc(g.find(i => i.label === 'Descanso do aquecimento')?.text || '')}</p>`;
}

let openWarm = false, openNotes = false, lastLine = null;

function techMark(line, st, set) {
  if (!line.tech || line.tech === 'N/A' || !L.isLastSet(line, st, set)) return '';
  return line.tech.startsWith('Parciais') ? 'LLP' : line.tech;
}

const numOf = (id, t) => (id === 'load' && L.isPC(t) ? null : L.parseNum(t));
function dialText(id, n, bw) { return n == null ? (id === 'load' && bw ? 'PC' : '') : L.fmtNum(n); }
function dialHtml(id, label, value, sug, step, lo, bw) {
  const cur = numOf(id, value);
  const ghost = n => `<span class="g">${esc(dialText(id, n, bw) || '—')}</span>`;
  return `<div class="field" id="${id === 'load' ? 'loadf' : 'valf'}"><label for="${id}">${esc(label)}</label>` +
    `<div class="dial" data-id="${id}" data-step="${step}" data-lo="${lo ?? ''}" data-bw="${bw ? 1 : ''}">` +
    `${ghost(L.dialApply(cur, 1, { step, lo }))}` +
    `<input id="${id}" inputmode="${id === 'load' ? 'decimal' : 'numeric'}" autocomplete="off" readonly placeholder="—" value="${esc(value)}" class="${sug ? 'sug' : ''}" data-sug="${id === 'load' && sug && !bw ? esc(value) : ''}">` +
    `${ghost(L.dialApply(cur, -1, { step, lo }))}</div></div>`;
}
function dialRefresh(d) {
  const id = d.dataset.id, inp = d.querySelector('input'), step = Number(d.dataset.step), lo = d.dataset.lo === '' ? null : Number(d.dataset.lo), bw = !!d.dataset.bw;
  const cur = numOf(id, inp.value), g = d.querySelectorAll('.g');
  g[0].textContent = dialText(id, L.dialApply(cur, 1, { step, lo }), bw) || '—';
  g[1].textContent = dialText(id, L.dialApply(cur, -1, { step, lo }), bw) || '—';
}
let drag = null, dragged = false;
document.addEventListener('pointerdown', e => {
  const d = e.target.closest('.dial'); if (!d) return;
  const inp = d.querySelector('input'); if (!inp.readOnly) return; // digitando
  const id = d.dataset.id;
  drag = { d, inp, id, y: e.clientY, cur: numOf(id, inp.value), step: Number(d.dataset.step), lo: d.dataset.lo === '' ? null : Number(d.dataset.lo), bw: !!d.dataset.bw, moved: false };
  dragged = false;
  try { d.setPointerCapture(e.pointerId); } catch { }
});
document.addEventListener('pointermove', e => {
  if (!drag) return;
  const dy = drag.y - e.clientY;
  if (!drag.moved && Math.abs(dy) < 8) return;
  drag.moved = true; dragged = true; e.preventDefault();
  const n = L.dialApply(drag.cur, L.dialSteps(dy, drag.id === 'load' ? 5 : 2), { step: drag.step, lo: drag.lo });
  drag.inp.value = dialText(drag.id, n, drag.bw); drag.inp.classList.remove('sug'); drag.inp.dataset.sug = '';
  drag.inp.parentElement.parentElement.classList.remove('err');
  dialRefresh(drag.d);
}, { passive: false });
const endDrag = () => { if (!drag) return; const m = drag.moved; drag = null; if (m) saveDraft(); };
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);
document.addEventListener('click', e => {
  const d = e.target.closest('.dial'); if (!d) return;
  if (dragged) { dragged = false; return; }
  const inp = d.querySelector('input'); if (!inp.readOnly) return;
  inp.readOnly = false; inp.focus(); try { inp.select(); } catch { }
});
document.addEventListener('focusout', e => {
  const t = e.target; if (!t.closest || !t.closest('.dial')) return;
  t.readOnly = true; if (t.value.trim() === '' && t.id === 'load' && t.parentElement.dataset.bw) t.value = 'PC';
  dialRefresh(t.parentElement);
});

function render() {
  const w = wo(), line = lineOf(), st = stOf(line), n = L.totalSets(line, st);
  if (view.set > n) view.set = n;
  if (lastLine !== line.id) { openWarm = false; openNotes = false; lastLine = line.id; }
  const pr = L.progress(w, logs, states, P.id);
  const opts = (arr, sel) => arr.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(sel) ? ' selected' : ''}>${esc(t)}</option>`).join('');
  const typeLabel = Object.fromEntries(L.WORKOUT_ORDER.map(t => [t, `${t} (${L.WORKOUT_DAYS[t]})`]));
  const lineItems = w.lines.map((l, i) => {
    const lp = L.lineProgress(l, logs, states, P.id), o = L.lineState(states, P.id, l).opt;
    return [l.id, `${i + 1}. ${exName(l, o)} · ${lp.done}/${lp.total}${lp.done === lp.total ? ' ✓' : ''}${l.ss ? ' ⇄' : ''}`];
  });
  $('top').innerHTML =
    `<div class="head"><h1>Meu treino · PPL</h1><span class="prog${pr.done === pr.total ? ' full' : ''}" aria-label="Séries concluídas">${pr.done}/${pr.total} séries</span><button class="menu" data-act="menu" aria-label="Menu">☰</button></div>` +
    `<div class="row2"><select id="selWeek" aria-label="Semana">${opts(P.weeks.map(x => [x.n, 'Sem. ' + x.n]), view.week)}</select>` +
    `<select id="selType" aria-label="Treino">${opts(L.WORKOUT_ORDER.map(t => [t, typeLabel[t] || t]), view.type)}</select>` +
    `<select id="selGym" aria-label="Academia">${opts([...gyms().map(g => [g.id, g.name]), ['__manage', 'Gerenciar academias…']], curGym())}</select></div>` +
    `<div class="bar"><i style="width:${pr.total ? Math.round(pr.done / pr.total * 100) : 0}%"></i></div>` +
    `<select class="exsel" id="selLine" aria-label="Exercícios do dia">${opts(lineItems, line.id)}</select>`;

  let b = '';
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if (!standalone && !meta.hideInstall) b += `<div class="banner info"><span>Para os dados ficarem seguros, adicione à Tela de Início e use sempre pelo ícone. Aberto no Safari, os dados ficam separados.</span><button data-act="hideInstall">Entendi</button></div>`;
  if (!store.available) b += `<div class="banner"><span>Este navegador não deixou guardar dados. Os registros se perdem ao fechar. Faça backup.</span></div>`;
  const lb = meta.lastBackup, dc = doneCount();
  if (dc > 0 && (!lb ? dc >= 12 : dc > lb.count && Date.now() - Date.parse(lb.at) > 7 * 864e5))
    b += `<div class="banner"><span>${lb ? 'Há registros novos há mais de 7 dias sem backup.' : 'Você ainda não fez backup.'}</span><button data-act="backup">Fazer backup</button></div>`;
  $('banners').innerHTML = b;

  const opt = st.opt, ex = line.options[opt], cur = currentRecord(line, opt, view.set);
  const isDone = cur && cur.status === 'done' && !cur.deleted;
  const last = L.isLastSet(line, st, view.set);
  const rpeVal = L.rpeFor(line, st, view.set);
  const other = line.options.some((_, o) => o !== opt && L.doneInOption(logs, P.id, line, o, view.set));
  const setsHtml = Array.from({ length: n }, (_, i) => {
    const s = i + 1, d = L.doneInOption(logs, P.id, line, opt, s), od = !d && L.positionDone(logs, P.id, line, s);
    return `<button data-act="set" data-set="${s}" class="${d ? 'done ' : ''}${od ? 'other ' : ''}${s === view.set ? 'sel' : ''}" aria-label="Série ${s}${d ? ' concluída' : ''}">${s}${(() => { const t = techMark(line, st, s), o = L.isOptionalSet(line, s); return t || o ? `<small>${o ? (t ? 'opc·' + t : 'opcional') : t}</small>` : ''; })()}</button>`;
  }).join('');

  const sug = !cur || cur.deleted ? L.suggestedLoad(P, logs, view.week, view.type, line, opt, view.set, curGym()) : null;
  const loadVal = cur && !cur.deleted ? L.fmtNum(cur.load) : '';
  const valVal = cur && !cur.deleted ? L.fmtNum(cur.value) : '';
  const bw = L.isBodyweight(ex.ex);
  const loadShown = loadVal !== '' ? loadVal : (sug != null ? L.fmtNum(sug) : (bw ? 'PC' : ''));
  const loadSug = loadVal === '' && (sug != null || bw);
  const cmp = L.comparison(P, logs, view.week, view.type, ex.ex, view.set);
  const gid = curGym(), many = gyms().length > 1;
  const gtag = r => many ? ` · ${esc(gymName(L.gymOf(r)))}` : '';
  const btn = (label, r) => `<button class="t" data-act="copy" data-load="${r.load ?? ''}">${label}: <b>${esc(L.fmtResult(r))}</b></button>`;
  let prevLine;
  if (cmp.kind === 'prev') prevLine = btn(`Sem. ${cmp.week}${gtag(cmp.rec)}`, cmp.rec);
  else if (cmp.kind === 'earlier') prevLine = `<span class="sub">Sem registro na semana ${view.week - 1}.</span>` + btn(`Última vez, sem. ${cmp.week}${gtag(cmp.rec)}`, cmp.rec);
  else prevLine = `<span class="sub">${view.week > 1 ? `Sem registro na semana ${view.week - 1}.` : 'Sem semana anterior neste programa'}</span>`;
  const lg = L.lastInGym(logs, ex.ex, view.set, gid, L.logId(P.id, line.id, opt, view.set));
  const sameAsPrev = lg && cmp.rec && lg.id === cmp.rec.id;
  const gymLine = lg ? btn(`Última vez na ${esc(gymName(gid))} · sem. ${lg.week} · série ${lg.set}${lg.set !== view.set ? ' (sem a série ' + view.set + ')' : ''}`, lg) : `<span class="sub">Nenhum registro deste exercício na ${esc(gymName(gid))}.</span>`;
  const cmpHtml = `<div class="cmp${cmp.rec || lg ? '' : ' none'}"><strong>Comparação · série ${view.set}</strong>${prevLine}${sameAsPrev ? '' : gymLine}${sameAsPrev ? `<span class="sub">É também a última nesta academia.</span>` : ''}</div>`;

  let optNote = '';
  if (line.opt) {
    const hist = [view.week - 2, view.week - 1].filter(x => x >= 1).map(wk => {
      const rs = L.weekResults(P, logs, wk, view.type, ex.ex);
      return `Sem. ${wk}: ${rs.length ? esc(rs.map(L.fmtResult).join(', ')) : 'sem registro'}`;
    }).join(' · ');
    optNote = `<h3>Série opcional</h3><p>Só faça a série opcional se o exercício progrediu (carga ou repetições) nas 2 semanas anteriores e a recuperação está boa. ${hist}</p>`;
  }

  const partner = L.partnerOf(w, line);
  const techItem = P.general.sections[1].items.find(i => i.label === line.tech);
  const hasTech = line.tech && line.tech !== 'N/A';
  let notes = '';
  if (hasTech) notes += `<h3>Técnica da última série</h3><div class="${last ? 'hl' : ''}"><p><b>${esc(line.tech)}</b></p><p>${esc(techItem?.text || '')}</p></div>`;
  notes += optNote;
  if (partner) notes += `<h3>Supersérie</h3><p>Com <b>${esc(exName(partner, L.lineState(states, P.id, partner).opt))}</b>. Descanso: ${esc(line.rest)}.</p>`;
  notes += `<h3>Orientações${opt ? ` (escritas para ${esc(exName(line, 0))})` : ''}</h3><p>${esc(line.notes)}</p>`;
  notes += `<h3>Vídeo</h3><a href="${esc(ex.url)}" target="_blank" rel="noopener">${ex.link === 'search' ? 'Buscar no YouTube' : 'Ver vídeo'}: ${esc(exName(line, opt))}</a>`;
  notes += `<button class="linkbtn" data-act="general">Orientações gerais do programa</button>`;
  const warm = `<h3>Aquecimento</h3>${warmupHtml(line)}`.replace('<h3>Aquecimento</h3>', '');

  const altTag = opt ? `<div class="tag alt">Alternativa selecionada. A prescrição e as orientações são da linha original (${esc(exName(line, 0))}).</div>` : '';
  const otherTag = other ? `<div class="tag">Esta série já foi registrada em outra opção desta linha.</div>` : '';
  const unit = line.unit === 's' ? 'Segundos' : 'Repetições';

  const seq = L.sequence(w, states, P.id);
  const idx = seq.findIndex(s => s.lineId === line.id && s.set === view.set);
  const nxt = !isDone ? L.nextPending(w, logs, states, P.id, { lineId: line.id, set: view.set }) : null;
  const nxtLine = nxt && L.getLine(w, nxt.lineId);
  const sub = nxtLine ? (nxtLine.id !== line.id ? `→ ${esc(exName(nxtLine, L.lineState(states, P.id, nxtLine).opt))}` : `→ série ${nxt.set}`) : '';
  const rt = L.resumeTarget(P, logs, states, meta.position);
  const away = meta.position && !(rt.week === view.week && rt.type === view.type && rt.step && rt.step.lineId === view.lineId && rt.step.set === view.set);

  $('card').innerHTML =
    `<section class="card">` +
    `<select class="exname" id="selOpt" aria-label="Exercício">${line.options.map((o, i) => `<option value="${i}"${i === opt ? ' selected' : ''}>${i === 0 ? 'Principal' : 'Alternativa ' + i}: ${esc(exName(line, i))}</option>`).join('')}</select>` +
    `<div class="chips"><span class="chip">Reps<b>${esc(line.reps)}</b></span><span class="chip">Rest<b class="${line.rest.length > 10 ? 'sm' : ''}">${esc(line.rest)}</b></span><span class="chip">RPE ${view.set}<b>${esc(rpeVal || '—')}</b></span></div>` +
    `<div class="sets">${setsHtml}</div>` + otherTag +
    `<div class="fields">${dialHtml('load', 'Carga (kg)', loadShown, loadSug, 1, null, L.isBodyweight(ex.ex))}${dialHtml('val', unit, valVal, false, line.unit === 's' ? 5 : 1, (String(line.reps).match(/\d+/) || [null])[0] == null ? null : Number(String(line.reps).match(/\d+/)[0]), false)}</div>` +
    cmpHtml + (isDone ? `<button class="unmark" data-act="unmark">Remover conclusão desta série</button>` : '') +
    `<button class="reg" data-act="register">${isDone ? 'Salvar alteração' : 'Registrar série e avançar'}${sub ? `<small>${sub}</small>` : ''}</button>` +
    `</section>` +
    `<div class="nav"><button data-act="prev" ${idx <= 0 ? 'disabled' : ''}>← Anterior</button><button data-act="next" ${idx >= seq.length - 1 ? 'disabled' : ''}>Próxima →</button>` +
    (away && rt.step ? `<button class="back" data-act="current">Voltar para a série atual</button>` : '') + `</div>` +
    `<button class="fold${openWarm ? ' open' : ''}" data-act="toggle" data-k="warm" aria-expanded="${openWarm}"><span>Aquecimento</span><i>▸</i></button>` +
    (openWarm ? `<div class="panel">${warm}</div>` : '') +
    `<button class="fold${openNotes ? ' open' : ''}" data-act="toggle" data-k="notes" aria-expanded="${openNotes}"><span>Observações e vídeo${hasTech && last ? '<span class="s">Técnica da última série</span>' : ''}</span><i>▸</i></button>` +
    (openNotes ? `<div class="panel">${altTag}${notes}</div>` : '');
  $('bar').innerHTML = '';

  focusValue = false;
}

function sheet(html) { const d = $('sheet'); d.innerHTML = html + `<button class="close" data-act="closeSheet">Fechar</button>`; if (!d.open) d.showModal(); }

function menuSheet() {
  const lb = meta.lastBackup;
  sheet(`<h2>Menu</h2>` +
    `<button class="item" data-act="general">Orientações gerais do programa</button>` +
    (P.changes && P.changes.length ? `<button class="item" data-act="changes">Alterações em relação à planilha<small>${P.changes.length} ajustes pedidos por você</small></button>` : '') +
    `<button class="item" data-act="gyms">Academias<small>${gyms().map(g => esc(g.name)).join(' · ')}</small></button>` +
    `<button class="item" data-act="backup">Fazer backup<small>${lb ? `Último: ${new Date(lb.at).toLocaleString('pt-BR')} (${lb.count} séries)` : 'Nenhum backup feito ainda'}</small></button>` +
    `<button class="item" data-act="restore">Restaurar backup<small>Junta com os registros atuais; vale o mais recente.</small></button>` +
    `<button class="item" data-act="csv">Exportar CSV<small>${doneCount()} séries concluídas</small></button>` +
    `<h3>Dados</h3><p>${doneCount()} séries concluídas neste aparelho. Armazenamento ${store.persistent ? 'protegido pelo navegador' : 'padrão do navegador (faça backup)'}.</p>` +
    `<p>Programa: ${esc(P.sourceFile)} · ${esc(P.id)}</p>`);
}
function gymsSheet() {
  sheet(`<h2>Academias</h2><p>Cada série registrada guarda a academia escolhida no topo. A comparação mostra a última vez na academia selecionada.</p>` +
    gyms().map(g => `<div class="gymrow"><input data-gym="${esc(g.id)}" value="${esc(g.name)}" maxlength="30" aria-label="Nome da academia"><button data-act="gymSave" data-id="${esc(g.id)}">Salvar</button></div>`).join('') +
    `<h3>Nova academia</h3><div class="gymrow"><input id="newGym" maxlength="30" placeholder="Nome" aria-label="Nova academia"><button data-act="gymAdd">Adicionar</button></div>` +
    `<p>Registros feitos antes desta função ficam na primeira academia da lista.</p>`);
}
async function saveGyms(list, cur) { await setMeta('gyms', list); if (cur) await setMeta('gym', cur); }
function generalSheet() {
  const g = P.general;
  const lines = g.notes.split('\n').map(x => x.trim()).filter(Boolean);
  const head = lines.filter(x => !x.startsWith('•')).join(' ');
  const topics = lines.filter(x => x.startsWith('•')).map(x => {
    const t = x.replace(/^•\s*/, ''), m = t.match(/^([^:]{1,60}):\s*([\s\S]*)$/);
    return m ? `<li><b>${esc(m[1])}:</b> ${esc(m[2])}</li>` : `<li>${esc(t)}</li>`;
  }).join('');
  sheet(`<h2>Orientações gerais</h2>${head ? `<p>${esc(head)}</p>` : ''}<ul class="topics">${topics}</ul>` + g.sections.map(s => `<h3>${esc(s.title)}</h3><dl>${s.items.map(i => `<dt>${esc(i.label)}</dt><dd>${esc(i.text)}</dd>`).join('')}</dl>`).join('') +
    P.blocks.map(b => `<h3>${esc(b.title)}</h3><p>${esc(b.text)}</p>`).join(''));
}

async function deliver(name, mime, text) {
  const file = new File([text], name, { type: mime });
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return true; } } catch (e) { if (e && e.name === 'AbortError') return false; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000); return true;
}
async function backup() {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const data = { format: 'lcs-workout-backup', version: 1, createdAt: now(), programs: [{ id: P.id, name: P.name, sourceFile: P.sourceFile, sha256: P.sha256 }],
    logs: Object.values(logs), states: Object.entries(states).map(([key, v]) => ({ key, ...v })), position: meta.position || null, gyms: gyms(), gym: curGym() };
  if (await deliver(`treino-backup-${stamp}.json`, 'application/json', JSON.stringify(data))) { await setMeta('lastBackup', { at: now(), count: doneCount() }); toast('Backup gerado.'); render(); }
}
async function restoreFile(file) {
  let obj; try { obj = JSON.parse(await file.text()); } catch { obj = null; }
  const err = L.validateBackup(obj);
  if (err) { sheet(`<h2>Restaurar backup</h2><div class="msg bad">${esc(err)} Nada foi alterado.</div>`); return; }
  const m = L.mergeLogs(logs, obj.logs);
  logs = m.logs; await store.putMany('logs', Object.entries(logs));
  const sts = (obj.states || []).filter(s => !states[s.key]);
  for (const s of sts) { const { key, ...v } = s; states[key] = v; }
  await store.putMany('states', Object.entries(states));
  if (Array.isArray(obj.gyms)) {
    const mine = gyms(), add = obj.gyms.filter(g => g && g.id && g.name && !mine.some(x => x.id === g.id));
    if (add.length) await setMeta('gyms', [...mine, ...add]);
  }
  if (!meta.position && obj.position) await setMeta('position', obj.position);
  sheet(`<h2>Backup restaurado</h2><div class="msg">${m.added} registros novos, ${m.updated} atualizados, ${m.ignored} já estavam iguais ou mais recentes.</div>`);
  const t = L.resumeTarget(P, logs, states, meta.position);
  if (t.step) { view.week = t.week; view.type = t.type; view.lineId = t.step.lineId; view.set = t.step.set; }
  render();
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act, line = view && lineOf && wo() ? lineOf() : null;
  switch (a) {
    case 'register': register(); break;
    case 'prev': move(-1); break;
    case 'next': move(1); break;
    case 'set': view.set = Number(el.dataset.set); render(); break;
    case 'unmark': unmark(); break;
    case 'undo': { const u = undo; $('toast').classList.remove('show'); undo = null; u && u(); break; }
    case 'menu': menuSheet(); break;
    case 'toggle': if (el.dataset.k === 'warm') openWarm = !openWarm; else openNotes = !openNotes; render(); break;
    case 'changes': sheet(`<h2>Alterações em relação à planilha</h2><ul class="topics">${P.changes.map(c => `<li>${esc(c)}</li>`).join('')}</ul><p>Os valores originais de cada linha alterada ficam guardados no programa.</p>`); break;
    case 'general': generalSheet(); break;
    case 'gyms': gymsSheet(); break;
    case 'gymSave': {
      const inp = document.querySelector(`[data-gym="${CSS.escape(el.dataset.id)}"]`), name = inp.value.trim();
      if (!name) { toast('Informe o nome.'); break; }
      saveGyms(gyms().map(g => g.id === el.dataset.id ? { ...g, name } : g)).then(() => { gymsSheet(); render(); toast('Nome salvo.'); }); break;
    }
    case 'gymAdd': {
      const name = $('newGym').value.trim();
      if (!name) { toast('Informe o nome.'); break; }
      const id = 'g' + Date.now().toString(36);
      saveGyms([...gyms(), { id, name }], id).then(() => { gymsSheet(); render(); toast('Academia adicionada e selecionada.'); }); break;
    }
    case 'closeSheet': $('sheet').close(); break;
    case 'hideInstall': setMeta('hideInstall', true); render(); break;
    case 'backup': backup(); break;
    case 'restore': $('file').value = ''; $('file').click(); break;
    case 'csv': deliver(`treino-registros-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv', L.toCsv(logs, gyms())); break;
    case 'current': { const t = L.resumeTarget(P, logs, states, meta.position); if (t.step) go(t.week, t.type, t.step.lineId, t.step.set); break; }
    case 'copy': { const l = el.dataset.load; if (l !== '') { const f = $('load'); f.value = L.fmtNum(Number(l)); f.classList.remove('sug'); f.dataset.sug = ''; dialRefresh(f.parentElement); saveDraft(); } break; }
  }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'selWeek') go(Number(t.value), view.type);
  else if (t.id === 'selType') go(view.week, t.value);
  else if (t.id === 'selLine') goLine(t.value);
  else if (t.id === 'selGym') { if (t.value === '__manage') { render(); gymsSheet(); } else setMeta('gym', t.value).then(render); }
  else if (t.id === 'selOpt') {
    const line = lineOf(), k = L.stateKey(P.id, line.id);
    states[k] = { ...(states[k] || { optionalOn: false }), opt: Number(t.value) }; persistState(line); render();
  } else if (t.id === 'file' && t.files[0]) restoreFile(t.files[0]);
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'load' || t.id === 'val') {
    if (t.id === 'load') t.classList.remove('sug');
    t.parentElement.classList.remove('err'); saveDraft();
  }
});
document.addEventListener('focusin', e => { if (e.target.id === 'load' && e.target.classList.contains('sug')) e.target.select(); });

init().catch(err => { document.body.insertAdjacentHTML('afterbegin', `<div class="banner">Erro ao iniciar: ${esc(err.message)}</div>`); console.error(err); });

// Reforço contra o zoom por toque duplo no iOS (o zoom por pinça não é afetado).
let lastTouchEnd = 0;
document.addEventListener('touchend', e => {
  const t = Date.now();
  if (t - lastTouchEnd < 350 && !(e.target.closest && e.target.closest('input,select,textarea'))) e.preventDefault();
  lastTouchEnd = t;
}, { passive: false });

// A janela do menu/orientações só fecha pelo botão "Fechar" (tocar fora não fecha).
$('sheet').addEventListener('cancel', e => e.preventDefault());
$('sheet').addEventListener('click', e => { if (e.target === $('sheet')) e.stopPropagation(); });
