import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as L from '../docs/logic.js';

const P = JSON.parse(readFileSync(new URL('../docs/program.json', import.meta.url)));
const pid = P.id;
const wo = (w, t) => L.getWorkout(P, w, t);
const name = (line, o = 0) => P.exercises[line.options[o].ex];
const byName = (w, t, n) => wo(w, t).lines.find(l => name(l) === n);
function rec(logs, w, t, line, opt, set, load, value, status = 'done') {
  const id = L.logId(pid, line.id, opt, set);
  logs[id] = { id, programId: pid, week: w, workout: t, lineId: line.id, pos: line.pos, opt, exId: line.options[opt].ex,
    exName: name(line, opt), origName: name(line), set, optional: set > line.sets, load, value, unit: line.unit,
    status, doneAt: status === 'done' ? '2026-01-01T10:00:00Z' : null, updatedAt: '2026-01-01T10:00:00Z', deleted: false, pass: 1 };
  return logs[id];
}
const seqNames = (w, t, states = {}) => L.sequence(wo(w, t), states, pid).map(s => `${name(L.getLine(wo(w, t), s.lineId))}#${s.set}`);

test('I1 contagens da importação', () => {
  const lines = P.weeks.flatMap(w => w.workouts.flatMap(x => x.lines));
  assert.equal(lines.length, 460);
  assert.equal(lines.reduce((a, l) => a + l.options.length, 0), 1380);
  assert.equal(Object.keys(P.exercises).length, 104);
  assert.equal(lines.reduce((a, l) => a + l.opt, 0), 24);
  for (const w of P.weeks) assert.equal(new Set(w.workouts.flatMap(x => x.lines.filter(l => l.ss).map(l => x.type + l.ss))).size, 4);
});
test('I2 semana 1: 2 séries, RPE ~7/~8, sem técnica', () => {
  for (const x of P.weeks[0].workouts) for (const l of x.lines) assert.deepEqual([l.sets, l.rpe1, l.rpeL, l.tech], [2, '~7', '~8', 'N/A']);
});
test('I3 Barbell RDL semanas 2-10', () => {
  for (let w = 2; w <= 10; w++) { const l = byName(w, 'Legs B', 'Barbell RDL'); assert.deepEqual([l.sets, l.rpe1, l.rpeL], [3, '~7', '~8']); }
});
test('I4 Standing Calf Raise, agora no Push A, semana 2', () => {
  const l = byName(2, 'Push A', 'Standing Calf Raise'); assert.deepEqual([l.sets, l.tech, l.rpeL], [3, 'Falha', '10']);
});
test('I5 nota diz 4 séries, linha manda 2', () => {
  const l = byName(1, 'Pull A', 'Seated Super-Bayesian High Cable Curl');
  assert.equal(l.sets, 2); assert.match(l.notes, /4 séries/);
});
test('I6 Suitcase Carry por tempo e por lado', () => {
  const l = byName(3, 'Legs A', 'Suitcase Carry'); assert.deepEqual([l.unit, l.perSide, l.reps], ['s', true, '30-40 s/lado']);
});
test('I7 link de busca marcado como busca', () => {
  const l = byName(1, 'Pull A', 'Straight-Arm Cable Pulldown'); assert.equal(l.options[0].link, 'search');
  assert.equal(byName(1, 'Pull A', 'Neutral-Grip Lat Pulldown').options[0].link, 'video');
});
test('R8 RPE da última série vem da planilha', () => {
  const l = byName(3, 'Push A', 'Low Incline Barbell Bench Press'); const st = { opt: 0, optionalOn: false };
  assert.equal(L.rpeFor(l, st, 3), '~9'); assert.equal(L.rpeFor(l, st, 1), '~8');
});
test('R1/R6 rascunho não conta; posição conta uma vez', () => {
  const logs = {}, l = byName(2, 'Pull A', 'Neutral-Grip Lat Pulldown');
  rec(logs, 2, 'Pull A', l, 0, 1, 50, 10, 'draft');
  assert.equal(L.progress(wo(2, 'Pull A'), logs, {}, pid).done, 0);
  rec(logs, 2, 'Pull A', l, 0, 1, 50, 10); rec(logs, 2, 'Pull A', l, 1, 1, 45, 10);
  assert.equal(L.progress(wo(2, 'Pull A'), logs, {}, pid).done, 1);
  assert.equal(L.doneInOption(logs, pid, l, 2, 1), false);
});
test('ordem da semana: Push, Pull, Legs e descanso no domingo', () => {
  assert.deepEqual(L.WORKOUT_ORDER, ['Push A', 'Pull A', 'Legs A', 'Push B', 'Pull B', 'Legs B']);
  assert.deepEqual(L.nextWorkout(P, 1, 'Legs B'), { week: 2, type: 'Push A' });
  assert.deepEqual(L.nextWorkout(P, 1, 'Push A'), { week: 1, type: 'Pull A' });
  assert.equal(L.WORKOUT_DAYS['Legs B'], 'Sáb'); assert.equal(Object.values(L.WORKOUT_DAYS).includes('Dom'), false);
});
test('R3 retomada na próxima série pendente', () => {
  const logs = {}, l = byName(2, 'Pull A', 'Neutral-Grip Lat Pulldown');
  rec(logs, 2, 'Pull A', l, 0, 1, 50, 10); rec(logs, 2, 'Pull A', l, 0, 2, 50, 9);
  const t = L.resumeTarget(P, logs, {}, { week: 2, type: 'Pull A', lineId: l.id, set: 2 });
  assert.deepEqual([t.week, t.type, t.step], [2, 'Pull A', { lineId: l.id, set: 3 }]);
});
test('retomada vai para o treino seguinte quando o treino terminou', () => {
  const logs = {}, w = wo(1, 'Legs B');
  for (const s of L.sequence(w, {}, pid)) rec(logs, 1, 'Legs B', L.getLine(w, s.lineId), 0, s.set, 10, 10);
  const last = w.lines.at(-1);
  const t = L.resumeTarget(P, logs, {}, { week: 1, type: 'Legs B', lineId: last.id, set: 2 });
  assert.deepEqual([t.week, t.type], [2, 'Push A']); assert.equal(t.step.set, 1);
});
test('C1/C2 semana anterior e série sem par', () => {
  const logs = {}, l2 = byName(2, 'Pull A', 'Neutral-Grip Lat Pulldown'), l3 = byName(3, 'Pull A', 'Neutral-Grip Lat Pulldown'), l1 = byName(1, 'Pull A', 'Neutral-Grip Lat Pulldown');
  rec(logs, 2, 'Pull A', l2, 0, 1, 50, 10);
  assert.equal(L.comparison(P, logs, 3, 'Pull A', l3.options[0].ex, 1).rec.load, 50);
  rec(logs, 1, 'Pull A', l1, 0, 1, 40, 10); rec(logs, 1, 'Pull A', l1, 0, 2, 40, 9);
  const c = L.comparison(P, logs, 2, 'Pull A', l2.options[0].ex, 3);
  assert.deepEqual([c.kind, c.week], ['none', 1]);
});
test('C3 principal na semana 5, alternativa na semana 6', () => {
  const logs = {}, l5 = byName(5, 'Pull A', 'Wide-Grip Lat Pulldown');
  rec(logs, 5, 'Pull A', l5, 0, 1, 60, 12);
  const l6 = byName(6, 'Pull A', 'Wide-Grip Machine Pulldown');
  assert.equal(name(l6, 1), 'Wide-Grip Lat Pulldown');
  const c = L.comparison(P, logs, 6, 'Pull A', l6.options[1].ex, 1);
  assert.deepEqual([c.kind, c.rec.load], ['prev', 60]);
  // C4: o principal da semana 6 nunca foi feito: não herda o resultado da mesma posição
  assert.equal(L.comparison(P, logs, 6, 'Pull A', l6.options[0].ex, 1).kind, 'none');
});
test('C5 mesmo exercício em outro treino não entra', () => {
  const logs = {}, a = byName(2, 'Push A', 'Standing Calf Raise'), b = byName(3, 'Legs A', 'Standing Calf Raise');
  rec(logs, 2, 'Push A', a, 0, 1, 80, 12);
  assert.equal(L.comparison(P, logs, 3, 'Legs A', b.options[0].ex, 1).kind, 'none');
});
test('C6 rascunho na semana anterior não aparece', () => {
  const logs = {}, l2 = byName(2, 'Push A', 'Pec Deck'), l3 = byName(3, 'Push A', 'Pec Deck');
  rec(logs, 2, 'Push A', l2, 0, 1, 50, 10, 'draft');
  assert.equal(L.comparison(P, logs, 3, 'Push A', l3.options[0].ex, 1).kind, 'none');
});
test('comparação recua para a última vez feita', () => {
  const logs = {}, l2 = byName(2, 'Push A', 'Pec Deck'), l4 = byName(4, 'Push A', 'Pec Deck');
  rec(logs, 2, 'Push A', l2, 0, 1, 50, 10);
  const c = L.comparison(P, logs, 4, 'Push A', l4.options[0].ex, 1);
  assert.deepEqual([c.kind, c.week], ['earlier', 2]);
});
test('S1 par igual 3 e 3 (Pull B, Hammer e Cable Crunch, semana 2)', () => {
  const q = seqNames(2, 'Pull B').filter(x => /Hammer|Crunch/.test(x));
  assert.deepEqual(q, ['DB Hammer Curl#1', 'Cable Crunch#1', 'DB Hammer Curl#2', 'Cable Crunch#2', 'DB Hammer Curl#3', 'Cable Crunch#3']);
});
test('S2 par desigual 3 e 2 (Legs A, Leg Extension e Pallof Press)', () => {
  const s = seqNames(2, 'Legs A').filter(x => /Leg Extension|Pallof/.test(x)).map(x => x.replace('Leg Extension', 'A').replace('Pallof Press', 'B'));
  assert.deepEqual(s, ['A#1', 'B#1', 'A#2', 'B#2', 'A#3']);
});
test('S3 opcional da Leg Extension ligada: 4 contra 2', () => {
  const le = byName(4, 'Legs A', 'Leg Extension');
  const states = { [L.stateKey(pid, le.id)]: { opt: 0, optionalOn: true } };
  const s = seqNames(4, 'Legs A', states).filter(x => /Leg Extension|Pallof/.test(x)).map(x => x.replace('Leg Extension', 'A').replace('Pallof Press', 'B'));
  assert.deepEqual(s, ['A#1', 'B#1', 'A#2', 'B#2', 'A#3', 'A#4']);
  assert.equal(L.isOptionalSet(le, 4), true);
  assert.equal(L.rpeFor(le, states[L.stateKey(pid, le.id)], 4), '~9');
  assert.equal(L.rpeFor(le, states[L.stateKey(pid, le.id)], 3), '~8-9');
});
test('S5/S8 opcional só onde a planilha marca', () => {
  for (const w of P.weeks) for (const x of w.workouts) for (const l of x.lines) {
    if (l.opt) { assert.ok([4, 5, 9, 10].includes(w.n)); assert.ok(!['Bíceps', 'Panturrilha'].includes(l.muscle)); }
  }
});
test('S7 desligar a opcional preserva o registro e tira do progresso', () => {
  const logs = {}, l = byName(4, 'Pull A', 'Wide-Grip Lat Pulldown'), k = L.stateKey(pid, l.id);
  const on = { [k]: { opt: 0, optionalOn: true } };
  rec(logs, 4, 'Pull A', l, 0, 3, 60, 10);
  assert.equal(L.lineProgress(l, logs, on, pid).total, 3);
  assert.equal(L.lineProgress(l, logs, on, pid).done, 1);
  assert.deepEqual(L.lineProgress(l, logs, {}, pid), { done: 0, total: 2 });
  assert.ok(logs[L.logId(pid, l.id, 0, 3)]);
  assert.match(L.toCsv(logs), /;3;sim;60;10;/);
});
test('carga sugerida: série anterior, depois comparação', () => {
  const logs = {}, l2 = byName(2, 'Push A', 'Pec Deck'), l3 = byName(3, 'Push A', 'Pec Deck');
  rec(logs, 2, 'Push A', l2, 0, 1, 50, 10);
  assert.equal(L.suggestedLoad(P, logs, 3, 'Push A', l3, 0, 1), 50);
  rec(logs, 3, 'Push A', l3, 0, 1, 52.5, 10);
  assert.equal(L.suggestedLoad(P, logs, 3, 'Push A', l3, 0, 2), 52.5);
  assert.equal(L.suggestedLoad(P, logs, 3, 'Push A', l3, 1, 1), null);
});
test('D2/D3 restauração não duplica e mantém o mais recente', () => {
  const logs = {}, l = byName(2, 'Push A', 'Pec Deck');
  const r = rec(logs, 2, 'Push A', l, 0, 1, 50, 10);
  let m = L.mergeLogs(logs, [structuredClone(r)]);
  assert.deepEqual([m.added, m.updated, m.ignored, Object.keys(m.logs).length], [0, 0, 1, 1]);
  m = L.mergeLogs(logs, [{ ...r, load: 55, updatedAt: '2026-02-01T00:00:00Z' }]);
  assert.equal(m.logs[r.id].load, 55);
  m = L.mergeLogs(logs, [{ ...r, load: 45, updatedAt: '2025-01-01T00:00:00Z' }]);
  assert.equal(m.logs[r.id].load, 50);
});
test('D4 backup inválido é recusado', () => {
  assert.ok(L.validateBackup({ foo: 1 })); assert.ok(L.validateBackup({ format: 'lcs-workout-backup', version: 1, logs: [{}] }));
  assert.equal(L.validateBackup({ format: 'lcs-workout-backup', version: 1, logs: [] }), null);
});
test('D8 CSV com BOM, ponto e vírgula e vírgula decimal', () => {
  const logs = {}, l = byName(2, 'Push A', 'Pec Deck');
  rec(logs, 2, 'Push A', l, 0, 1, 52.5, 10); rec(logs, 2, 'Push A', l, 0, 2, 50, 9, 'draft');
  const csv = L.toCsv(logs);
  assert.ok(csv.startsWith('﻿programa;semana')); assert.match(csv, /;52,5;10;repetições;/);
  assert.equal(csv.trim().split('\r\n').length, 2);
});
test('números aceitam vírgula e ponto', () => {
  assert.equal(L.parseNum('52,5'), 52.5); assert.equal(L.parseNum('52.5'), 52.5); assert.equal(L.parseNum(''), null); assert.equal(L.parseNum('abc'), null);
});

test('ajuste: bíceps e panturrilha redistribuídos, 14 séries cada, notas corrigidas', () => {
  const vol = (w, m) => Object.fromEntries(P.weeks[w - 1].workouts.map(x => [x.type, x.lines.filter(l => l.muscle === m).reduce((a, l) => a + l.sets, 0)]).filter(([, v]) => v));
  for (const w of [2, 3, 8]) {
    assert.deepEqual(vol(w, 'Bíceps'), { 'Push A': 4, 'Pull A': 4, 'Pull B': 6 });
    assert.deepEqual(vol(w, 'Panturrilha'), { 'Push A': 3, 'Legs A': 4, 'Pull B': 3, 'Legs B': 4 });
  }
  for (const w of P.weeks) {
    const last = x => x.lines.at(-1).muscle; assert.equal(last(w.workouts.find(x => x.type === 'Push A')), 'Antebraço');
    for (const x of w.workouts) for (const l of x.lines) {
      assert.doesNotMatch(l.notes, /domingo|puxada de sexta|neutra de segunda|técnica de segunda/);
      if (l.rest.startsWith('Supersérie')) assert.ok(l.ss, 'linha com descanso de supersérie precisa de par');
      else assert.equal(l.ss, null);
    }
  }
  assert.match(P.general.notes, /Seg Push A · Ter Pull A/); assert.ok(P.changes.length >= 5);
  const moved = P.weeks[1].workouts.flatMap(x => x.lines.filter(l => l.moved).map(l => [x.type, l.moved, l.orig.rest]));
  assert.deepEqual(moved, [['Push A', 'Legs A', 'Supersérie: 2 min após o par'], ['Push A', 'Pull A', 'Supersérie: 2 min após o par'], ['Pull B', 'Push B', 'Supersérie: 2 min após o par']]);
});
test('ajuste: registros antigos continuam achados pelo id da linha', () => {
  const calfOld = P.weeks[1].workouts.find(x => x.type === 'Push A').lines.find(l => l.moved === 'Pull A');
  assert.match(calfOld.id, /^w2-pull-a-/);
  const logs = {}; rec(logs, 2, 'Pull A', calfOld, 0, 1, 70, 12);
  assert.equal(L.positionDone(logs, pid, calfOld, 1), true);
});
