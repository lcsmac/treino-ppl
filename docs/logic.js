// Regras puras do aplicativo (sem tela e sem armazenamento). Testadas em tests/logic.test.mjs.

// Ordem de uso na semana (escolha do Lucas): Push, Pull, Legs, duas vezes, com descanso no domingo.
// A prescrição de cada treino (exercícios, séries, notas) continua exatamente a da planilha.
export const WORKOUT_ORDER = ['Push A', 'Pull A', 'Legs A', 'Push B', 'Pull B', 'Legs B'];
export const WORKOUT_DAYS = { 'Push A': 'Seg', 'Pull A': 'Ter', 'Legs A': 'Qua', 'Push B': 'Qui', 'Pull B': 'Sex', 'Legs B': 'Sáb' };

export function getWeek(program, n) { return program.weeks.find(w => w.n === n); }
export function getWorkout(program, n, type) {
  const w = getWeek(program, n);
  return w && w.workouts.find(x => x.type === type);
}
export function getLine(workout, lineId) { return workout.lines.find(l => l.id === lineId); }

export const logId = (programId, lineId, opt, set) => `${programId}|${lineId}|${opt}|${set}`;
export const stateKey = (programId, lineId) => `${programId}|${lineId}`;

/** Estado da linha: opção selecionada e série opcional ligada. */
export function lineState(states, programId, line) {
  return states[stateKey(programId, line.id)] || { opt: 0, optionalOn: false };
}

/** Total de séries visíveis na linha (base + opcional quando ligada). */
export function totalSets(line, st) { return line.sets + (line.opt && st.optionalOn ? line.opt : 0); }

export function isOptionalSet(line, set) { return set > line.sets; }

/** RPE da série: a última série visível usa o RPE da última série da planilha. */
export function rpeFor(line, st, set) { return set === totalSets(line, st) ? line.rpeL : line.rpe1; }
export function isLastSet(line, st, set) { return set === totalSets(line, st); }

/** Sequência de passos do treino: superséries alternam A1, B1, A2, B2...; sobras seguem sozinhas. */
export function sequence(workout, states, programId) {
  const steps = [];
  const L = workout.lines;
  for (let i = 0; i < L.length; i++) {
    const a = L[i], b = L[i + 1];
    const na = totalSets(a, lineState(states, programId, a));
    if (a.ss && b && b.ss === a.ss) {
      const nb = totalSets(b, lineState(states, programId, b));
      for (let s = 1; s <= Math.max(na, nb); s++) {
        if (s <= na) steps.push({ lineId: a.id, set: s });
        if (s <= nb) steps.push({ lineId: b.id, set: s });
      }
      i++;
    } else {
      for (let s = 1; s <= na; s++) steps.push({ lineId: a.id, set: s });
    }
  }
  return steps;
}

export function partnerOf(workout, line) {
  if (!line.ss) return null;
  return workout.lines.find(l => l.ss === line.ss && l.id !== line.id) || null;
}

const isDone = r => !!r && r.status === 'done' && !r.deleted;

/** Uma posição (linha + série) conta como concluída se qualquer opção tiver registro concluído. */
export function positionDone(logs, programId, line, set) {
  return line.options.some((_, o) => isDone(logs[logId(programId, line.id, o, set)]));
}
export function doneInOption(logs, programId, line, opt, set) {
  return isDone(logs[logId(programId, line.id, opt, set)]);
}

export function progress(workout, logs, states, programId) {
  const steps = sequence(workout, states, programId);
  const done = steps.filter(s => positionDone(logs, programId, getLine(workout, s.lineId), s.set)).length;
  return { done, total: steps.length };
}
export function lineProgress(line, logs, states, programId) {
  const n = totalSets(line, lineState(states, programId, line));
  let done = 0;
  for (let s = 1; s <= n; s++) if (positionDone(logs, programId, line, s)) done++;
  return { done, total: n };
}

/** Próximo passo pendente depois de `from` (ou do início); null se o treino terminou. */
export function nextPending(workout, logs, states, programId, from) {
  const steps = sequence(workout, states, programId);
  const pend = s => !positionDone(logs, programId, getLine(workout, s.lineId), s.set);
  let i = from ? steps.findIndex(s => s.lineId === from.lineId && s.set === from.set) : -1;
  for (let k = i + 1; k < steps.length; k++) if (pend(steps[k])) return steps[k];
  for (let k = 0; k <= i && k < steps.length; k++) if (pend(steps[k])) return steps[k];
  return null;
}

export function nextWorkout(program, week, type) {
  const i = WORKOUT_ORDER.indexOf(type);
  if (i < WORKOUT_ORDER.length - 1) return { week, type: WORKOUT_ORDER[i + 1] };
  if (getWeek(program, week + 1)) return { week: week + 1, type: WORKOUT_ORDER[0] };
  return null;
}

/** Onde reabrir: próxima série pendente depois do último registro; treino seguinte se terminou. */
export function resumeTarget(program, logs, states, position) {
  if (!position) return { week: 1, type: WORKOUT_ORDER[0], step: null };
  let { week, type } = position, from = { lineId: position.lineId, set: position.set };
  for (let guard = 0; guard < 80; guard++) {
    const wo = getWorkout(program, week, type);
    if (!wo) break;
    const step = nextPending(wo, logs, states, program.id, from);
    if (step) return { week, type, step };
    const nx = nextWorkout(program, week, type);
    if (!nx) return { week, type, step: null };
    week = nx.week; type = nx.type; from = null;
  }
  return { week: position.week, type: position.type, step: null };
}

/** Registro concluído do exercício `exId`, série `set`, no treino `type` da semana `week`. */
export function resultIn(program, logs, week, type, exId, set) {
  const wo = getWorkout(program, week, type);
  if (!wo) return null;
  for (const line of wo.lines) {
    const o = line.options.findIndex(x => x.ex === exId);
    if (o >= 0) {
      const r = logs[logId(program.id, line.id, o, set)];
      if (isDone(r)) return r;
    }
  }
  return null;
}

/** Comparação: semana anterior; se vazia, a última vez em que o exercício foi feito nesse treino. */
export function comparison(program, logs, week, type, exId, set) {
  const prev = week > 1 ? resultIn(program, logs, week - 1, type, exId, set) : null;
  if (prev) return { kind: 'prev', week: week - 1, rec: prev };
  for (let w = week - 2; w >= 1; w--) {
    const r = resultIn(program, logs, w, type, exId, set);
    if (r) return { kind: 'earlier', week: w, rec: r };
  }
  return { kind: 'none', week: week - 1, rec: null };
}

export const DEFAULT_GYM = 'g1';
export const DEFAULT_GYMS = [{ id: 'g1', name: 'BT' }, { id: 'g2', name: 'BF' }, { id: 'g3', name: 'Ultra' }];
export const gymOf = r => (r && r.gym) || DEFAULT_GYM;

/** Última vez que o exercício foi feito na academia `gym` (qualquer semana), de preferência na mesma série. */
export function lastInGym(logs, exId, set, gym, excludeId) {
  let best = null, bestSame = null;
  for (const r of Object.values(logs)) {
    if (!isDone(r) || r.exId !== exId || r.id === excludeId || gymOf(r) !== gym) continue;
    const t = r.doneAt || r.updatedAt || '';
    if (!best || t > (best.doneAt || best.updatedAt || '')) best = r;
    if (r.set === set && (!bestSame || t > (bestSame.doneAt || bestSame.updatedAt || ''))) bestSame = r;
  }
  return bestSame || best;
}

/** Carga sugerida: série anterior do mesmo exercício neste treino; senão, a da comparação. */
export function suggestedLoad(program, logs, week, type, line, opt, set, gym) {
  for (let s = set - 1; s >= 1; s--) {
    const r = logs[logId(program.id, line.id, opt, s)];
    if (isDone(r) && r.load != null) return r.load;
  }
  if (gym) {
    const g = lastInGym(logs, line.options[opt].ex, set, gym, logId(program.id, line.id, opt, set));
    if (g && g.load != null) return g.load;
  }
  const c = comparison(program, logs, week, type, line.options[opt].ex, set);
  return c.rec && c.rec.load != null ? c.rec.load : null;
}

/** Séries concluídas do exercício em uma semana (para a condição da série opcional). */
export function weekResults(program, logs, week, type, exId) {
  const out = [];
  for (let s = 1; s <= 5; s++) {
    const r = resultIn(program, logs, week, type, exId, s);
    if (r) out.push(r);
  }
  return out;
}

export function parseNum(text) {
  if (text == null) return null;
  const t = String(text).trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
export function fmtNum(n) { return n == null ? '' : String(n).replace('.', ','); }
export function fmtResult(r) {
  const v = `${fmtNum(r.value)}${r.unit === 's' ? ' s' : ''}`;
  return r.load == null ? `PC × ${v}` : `${fmtNum(r.load)} kg × ${v}`;
}

/** Mescla registros de um backup: fica o de alteração mais recente. */
export function mergeLogs(current, incoming) {
  let added = 0, updated = 0, ignored = 0;
  const out = { ...current };
  for (const r of incoming) {
    const cur = out[r.id];
    if (!cur) { out[r.id] = r; added++; }
    else if ((r.updatedAt || '') > (cur.updatedAt || '')) { out[r.id] = r; updated++; }
    else ignored++;
  }
  return { logs: out, added, updated, ignored };
}

export function validateBackup(obj) {
  if (!obj || obj.format !== 'lcs-workout-backup' || !Array.isArray(obj.logs)) return 'Este arquivo não é um backup deste aplicativo.';
  if (obj.version > 1) return 'Este backup foi feito por uma versão mais nova do aplicativo.';
  for (const r of obj.logs) {
    if (!r || typeof r.id !== 'string' || !r.programId || !r.lineId || typeof r.set !== 'number') return 'O backup está incompleto ou corrompido.';
  }
  return null;
}

export function toCsv(logs, gyms = []) {
  const gymName = id => (gyms.find(g => g.id === id) || {}).name || (id === DEFAULT_GYM ? 'BT' : id);
  const head = ['programa', 'semana', 'treino', 'posicao', 'exercicio_original', 'exercicio_realizado', 'opcao', 'serie', 'opcional', 'carga_kg', 'valor', 'unidade', 'concluida_em', 'alterada_em', 'academia', 'id'];
  const rows = Object.values(logs).filter(isDone).sort((a, b) =>
    a.programId.localeCompare(b.programId) || a.week - b.week || WORKOUT_ORDER.indexOf(a.workout) - WORKOUT_ORDER.indexOf(b.workout) || a.pos - b.pos || a.set - b.set || a.opt - b.opt);
  const q = v => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const optName = ['principal', 'alternativa 1', 'alternativa 2'];
  const lines = rows.map(r => [r.programId, r.week, r.workout, r.pos, r.origName, r.exName, optName[r.opt], r.set, r.optional ? 'sim' : 'não',
    fmtNum(r.load), fmtNum(r.value), r.unit === 's' ? 'segundos' : 'repetições', r.doneAt, r.updatedAt, gymName(gymOf(r)), r.id].map(q).join(';'));
  return '﻿' + [head.join(';'), ...lines].join('\r\n') + '\r\n';
}
