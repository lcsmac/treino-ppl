#!/usr/bin/env python3
"""Converte a aba PPL da planilha em app/program.json e imprime o relatório de conferência.
Uso: python3 tools/convert.py planilha.xlsx app/program.json"""
import sys, re, json, hashlib, unicodedata, collections, datetime
import openpyxl

src, out = sys.argv[1], sys.argv[2]
sha = hashlib.sha256(open(src, 'rb').read()).hexdigest()
ws = openpyxl.load_workbook(src)['PPL']
V = lambda r, c: ws.cell(r, c).value
def link(r, c):
    h = ws.cell(r, c).hyperlink
    return h.target if h else None
def fill(r, c):
    f = ws.cell(r, c).fill
    return f.fgColor.rgb if f and f.fill_type else None
def slug(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')
def txt(v):
    return '' if v is None else str(v).strip()

errors = []
def check(cond, msg):
    if not cond: errors.append(msg)

general = {'title': txt(V(1, 1)), 'subtitle': txt(V(2, 1)), 'notes': txt(V(4, 1)), 'sections': []}
sec = None
for r in range(6, 22):
    a, d = V(r, 1), V(r, 4)
    if a and not d:
        sec = {'title': txt(a), 'items': []}; general['sections'].append(sec)
    elif a and d and sec is not None:
        sec['items'].append({'label': txt(a), 'text': txt(d)})

weeks, exercises = [], {}
week = workout = block = None
blocks = []
for r in range(22, ws.max_row + 1):
    a, b = V(r, 1), V(r, 2)
    if isinstance(a, str) and a.startswith('BLOCO'):
        block = {'title': a.strip(), 'text': txt(V(r + 1, 1))}; blocks.append(block); continue
    if isinstance(a, str) and re.fullmatch(r'Semana \d+', a.strip()):
        week = {'n': int(a.split()[1]), 'block': len(blocks), 'workouts': []}; weeks.append(week); workout = None; continue
    if isinstance(a, str) and a.startswith('Descanso'):
        if week and week['workouts']: week['workouts'][-1]['after'] = a.strip()
        workout = None; continue
    if isinstance(a, str) and re.match(r'(Pull|Push|Legs) [AB]', a):
        t = a.split('\n')[0].strip()
        workout = {'type': t, 'label': ' '.join(a.split()), 'lines': []}; week['workouts'].append(workout)
    if not (b and week and workout) or b == 'Exercício': continue
    cells = [(V(r, c), fill(r, c)) for c in range(7, 11)]
    sets, opt = V(r, 5), V(r, 19) or 0
    white = sum(1 for v, f in cells if f == '00FFFFFF')
    optc = sum(1 for v, f in cells if v == 'opcional')
    check(white == sets and optc == opt, f'linha {r}: células de série ({white}+{optc}) diferem de Séries Válidas/Opc. ({sets}+{opt})')
    check(V(r, 18) == week['n'], f'linha {r}: coluna Sem. difere da semana')
    reps = txt(V(r, 6))
    options = []
    for role, c in ((0, 2), (1, 14), (2, 15)):
        name = txt(V(r, c))
        if not name:
            check(role == 0, f'linha {r}: alternativa {role} vazia'); continue
        eid = slug(name)
        check(exercises.get(eid, name) == name, f'linha {r}: nomes diferentes com o mesmo id {eid}')
        exercises[eid] = name
        url = link(r, c)
        options.append({'ex': eid, 'url': url, 'link': None if not url else ('search' if 'search_query' in url else 'video')})
    pos = len(workout['lines']) + 1
    workout['lines'].append({
        'id': f"w{week['n']}-{slug(workout['type'])}-{pos}", 'pos': pos, 'row': r,
        'sets': sets, 'opt': opt, 'reps': reps,
        'unit': 's' if re.search(r'\d\s*s\b', reps) else 'reps', 'perSide': '/lado' in reps,
        'rpe1': txt(V(r, 11)), 'rpeL': txt(V(r, 12)), 'rest': txt(V(r, 13)), 'warm': txt(V(r, 4)),
        'tech': txt(V(r, 3)), 'notes': txt(V(r, 16)), 'muscle': txt(V(r, 17)), 'ss': None, 'options': options})

# superséries: coluna Descanso + vizinhança
pairs_per_week = collections.Counter()
for w in weeks:
    for wo in w['workouts']:
        L = wo['lines']; i = 0; g = 0
        while i < len(L):
            if L[i]['rest'].startswith('Supersérie'):
                ok = i + 1 < len(L) and L[i + 1]['rest'].startswith('Supersérie')
                check(ok, f"linha {L[i]['row']}: supersérie sem par vizinho")
                if ok:
                    g += 1; L[i]['ss'] = L[i + 1]['ss'] = g; pairs_per_week[w['n']] += 1; i += 2; continue
            i += 1
        names = [o['ex'] for l in L for o in l['options']]
        check(len(names) == len(set(names)), f"semana {w['n']} {wo['type']}: exercício repetido no mesmo treino")

lines = [l for w in weeks for wo in w['workouts'] for l in wo['lines']]
nopt = sum(len(l['options']) for l in lines)
links = collections.Counter(o['link'] for l in lines for o in l['options'])
rep = {
 'linhas': len(lines), 'semanas': len(weeks),
 'linhas_por_semana': sorted({sum(len(wo['lines']) for wo in w['workouts']) for w in weeks}),
 'treinos_por_semana': sorted({len(w['workouts']) for w in weeks}),
 'opcoes': nopt, 'exercicios': len(exercises), 'series_opcionais': sum(l['opt'] for l in lines),
 'semanas_com_opcional': sorted({w['n'] for w in weeks for wo in w['workouts'] for l in wo['lines'] if l['opt']}),
 'pares_superserie_por_semana': sorted(set(pairs_per_week.values())),
 'links_video': links['video'], 'links_busca': links['search'], 'sem_link': links[None],
 'por_tempo': sorted({exercises[l['options'][0]['ex']] for l in lines if l['unit'] == 's'}),
 'series_semana_1': sorted({l['sets'] for l in weeks[0]['workouts'] for l in l['lines']}) if weeks else [],
}
exp = {'linhas': 460, 'semanas': 10, 'linhas_por_semana': [46], 'treinos_por_semana': [6], 'opcoes': 1380,
       'exercicios': 104, 'series_opcionais': 24, 'semanas_com_opcional': [4, 5, 9, 10],
       'pares_superserie_por_semana': [7], 'sem_link': 0}
for k, v in exp.items():
    check(rep[k] == v, f'conferência: {k} = {rep[k]}, esperado {v}')
print('RELATÓRIO DE CONFERÊNCIA'); [print(f'  {k}: {v}') for k, v in rep.items()]
if errors:
    print('\nFALHOU:'); [print('  -', e) for e in errors]
    if '--force' not in sys.argv: sys.exit(1)
for l in lines: del l['row']
prog = {'id': 'ppl-hibrido-' + sha[:8], 'name': general['title'], 'sourceFile': 'Programa_PPL_Hibrido (7).xlsx',
        'sha256': sha, 'general': general, 'blocks': blocks, 'exercises': exercises, 'weeks': weeks, 'report': rep}
json.dump(prog, open(out, 'w'), ensure_ascii=False, separators=(',', ':'))
print('\nOK ->', out, prog['id'])
