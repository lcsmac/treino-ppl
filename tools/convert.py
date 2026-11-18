#!/usr/bin/env python3
"""Converte a aba PPL da planilha em docs/program.json e imprime o relatório de conferência.
Uso: python3 tools/convert.py planilha.xlsx docs/program.json"""
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
print('RELATÓRIO DE CONFERÊNCIA (planilha original)'); [print(f'  {k}: {v}') for k, v in rep.items()]
if errors:
    print('\nFALHOU:'); [print('  -', e) for e in errors]
    if '--force' not in sys.argv: sys.exit(1)
for l in lines: del l['row']

# ---------------------------------------------------------------------------
# AJUSTES PEDIDOS PELO LUCAS (18/11/2026), aplicados depois da importação fiel.
# A planilha continua intacta; cada linha mudada guarda o original em 'orig'.
#  1. Semana Push, Pull, Legs (descanso no domingo): notas que citavam dias foram corrigidas.
#  2. Bíceps: o Preacher sai do Legs A (quarta, colado no Pull A de terça) e vai para o Push A (segunda).
#  3. Panturrilha: sai do Pull A (terça) e do Push B (quinta) e vai para o Push A (segunda) e o Pull B (sexta),
#     ficando segunda, quarta, sexta e sábado.
#  4. Linhas que perderam o par de supersérie ficam avulsas, com o descanso padrão dos isolados da planilha.
# ---------------------------------------------------------------------------
changes = []
ADJUST = '--no-adjust' not in sys.argv
SS_RE = re.compile(r'^SUPERSÉRIE com .*?aumente o descanso do par\)\.\s*')
NOTE_FIXES = [
    ('(vem depois do RDL de domingo)', '(o RDL é só no sábado, 3 dias antes)'),
    ('complementa a neutra de segunda', 'complementa a neutra de terça'),
    ('mesma técnica de segunda', 'mesma técnica de terça'),
    ('2ª exposição semanal do bíceps', '1ª exposição semanal do bíceps (segunda)'),
    ('recuperação para a puxada de sexta', 'recuperação para a puxada de terça'),
    (' Panturrilha em supersérie com o tríceps (músculos independentes).', ''),
]
STD_REST = '1,5-3 min'

def is_name(line, name):
    return exercises[line['options'][0]['ex']] == name

if ADJUST:
    for w in weeks:
        wk = {x['type']: x for x in w['workouts']}
        pullA, pushA, legsA, pushB, pullB = wk['Pull A'], wk['Push A'], wk['Legs A'], wk['Push B'], wk['Pull B']
        take = lambda wo, pred: wo['lines'].pop(next(i for i, l in enumerate(wo['lines']) if pred(l)))
        calf_a = take(pullA, lambda l: is_name(l, 'Standing Calf Raise'))
        calf_b = take(pushB, lambda l: is_name(l, 'Standing Calf Raise'))
        preacher = take(legsA, lambda l: l['muscle'] == 'Bíceps')
        for wo, items in ((pushA, [preacher, calf_a]), (pullB, [calf_b])):
            check(wo['lines'][-1]['muscle'] == 'Antebraço', f"semana {w['n']} {wo['type']}: último exercício não é o de antebraço")
            last = wo['lines'].pop()
            wo['lines'].extend(items); wo['lines'].append(last)
        for item, src in ((preacher, 'Legs A'), (calf_a, 'Pull A'), (calf_b, 'Push B')):
            item['moved'] = src
    for w in weeks:
        for wo in w['workouts']:
            partners_lost = []
            for l in wo['lines']:
                orig = {'notes': l['notes'], 'rest': l['rest']}
                n = l['notes']
                had_ss = bool(SS_RE.match(n)) or l['rest'].startswith('Supersérie')
                # o par só continua se o parceiro citado ainda estiver vizinho
                m = re.match(r'^SUPERSÉRIE com (.+?) \(faça', n)
                if m:
                    names = [exercises[x['options'][0]['ex']] for x in wo['lines']]
                    i = wo['lines'].index(l)
                    near = [names[j] for j in (i - 1, i + 1) if 0 <= j < len(names)]
                    if m.group(1) in near:
                        had_ss = False  # par preservado: não mexe
                    else:
                        n = SS_RE.sub('', n)
                        l['rest'] = STD_REST
                for a, b in NOTE_FIXES: n = n.replace(a, b)
                if n != l['notes'] or l['rest'] != orig['rest'] or l.get('moved'):
                    if l.get('moved'):
                        l['rest'] = STD_REST if l['rest'].startswith('Supersérie') else l['rest']
                    l['notes'] = n; l['orig'] = orig
            for i, l in enumerate(wo['lines']): l['pos'] = i + 1
    g = general
    g['notes_original'] = g['notes']
    n = g['notes']
    rep_g = [
        ('Seg Pull A · Ter Push A · Qua Legs A · Qui DESCANSO · Sex Pull B · Sáb Push B · Dom Legs B. 2º descanso opcional após o Legs B (ciclo de 8 dias).',
         'Seg Push A · Ter Pull A · Qua Legs A · Qui Push B · Sex Pull B · Sáb Legs B · Dom DESCANSO (ordem e descanso escolhidos por você; a planilha original tinha descanso na quinta).'),
        ('bíceps (3x/semana: Seg, Qua, Sex), panturrilha (4x)', 'bíceps (3x/semana: Seg, Ter, Sex), panturrilha (4x: Seg, Qua, Sex, Sáb)'),
        ('(1) panturrilha de sábado para domingo: se o domingo cair em repetições ou carga, mova as 3 séries de sábado para a terça;',
         '(1) panturrilha de sexta para sábado: se o sábado cair em repetições ou carga, mova as 3 séries de sexta para a quinta;'),
    ]
    for a, b in rep_g:
        check(a in n, 'nota geral não encontrada: ' + a[:40]); n = n.replace(a, b)
    g['notes'] = n
    changes = [
      'Ordem da semana: Seg Push A · Ter Pull A · Qua Legs A · Qui Push B · Sex Pull B · Sáb Legs B · Dom descanso. O descanso de quinta e o descanso opcional da planilha deixaram de existir.',
      'Bíceps: a Preacher Curl (4 séries moderadas, sem falha) saiu do Legs A (quarta, colada no Pull A de terça) e foi para o Push A (segunda). Bíceps agora: segunda, terça e sexta, 14 séries, como antes.',
      'Panturrilha: a série da terça (Pull A) e a da quinta (Push B) foram para o Push A (segunda) e o Pull B (sexta). Panturrilha agora: segunda, quarta, sexta e sábado, 14 séries, como antes.',
      'Os exercícios movidos ficam antes do exercício de antebraço, que continua sendo o último do dia. Séries, repetições, RPE, técnicas e alternativas deles não mudaram.',
      'Supersérie: as linhas que perderam o par (Rear Delt Flye, elevação lateral do Legs A e extensão de tríceps do Push B) ficaram avulsas e as linhas movidas entram avulsas, todas com o descanso padrão dos isolados da planilha (1,5-3 min). Pares por semana: de 7 para 4.',
      'Notas corrigidas: referências a "RDL de domingo", "puxada de sexta", "de segunda", a nota geral de Divisão, Prioridades e o ponto de observação da panturrilha. A frase "SUPERSÉRIE com …" foi retirada das linhas que deixaram de ter par.',
    ]
    rep_adj = {'pares_superserie_por_semana': sorted({len({l['ss'] for wo in w['workouts'] for l in wo['lines'] if l['ss'] is not None and False}) for w in weeks})}
    # recalcula os pares
    pp = collections.Counter()
    for w in weeks:
        for wo in w['workouts']:
            L = wo['lines']; i = 0; gi = 0
            for l in L: l['ss'] = None
            while i < len(L):
                if L[i]['rest'].startswith('Supersérie') and i + 1 < len(L) and L[i + 1]['rest'].startswith('Supersérie'):
                    gi += 1; L[i]['ss'] = L[i + 1]['ss'] = gi; pp[w['n']] += 1; i += 2; continue
                check(not L[i]['rest'].startswith('Supersérie'), f"semana {w['n']} {wo['type']}: linha com descanso de supersérie sem par")
                i += 1
    bic = collections.Counter(); cal = collections.Counter()
    for w in weeks[1:2]:
        for wo in w['workouts']:
            for l in wo['lines']:
                if l['muscle'] == 'Bíceps': bic[wo['type']] += l['sets']
                if l['muscle'] == 'Panturrilha': cal[wo['type']] += l['sets']
    print('\nAJUSTES APLICADOS (semana 2)'); print('  pares por semana:', sorted(set(pp.values())))
    print('  bíceps por treino:', dict(bic), '= total', sum(bic.values())); print('  panturrilha por treino:', dict(cal), '= total', sum(cal.values()))
    check(sorted(set(pp.values())) == [4], 'após o ajuste esperava 4 pares por semana')
    check(sum(bic.values()) == 14 and sum(cal.values()) == 14, 'volume de bíceps/panturrilha mudou')
    check(set(bic) == {'Push A', 'Pull A', 'Pull B'} and set(cal) == {'Push A', 'Legs A', 'Pull B', 'Legs B'}, 'distribuição por treino inesperada')
    rep['ajustado'] = True
    if errors:
        print('\nFALHOU:'); [print('  -', e) for e in errors]; sys.exit(1)

prog = {'id': 'ppl-hibrido-' + sha[:8], 'name': general['title'], 'sourceFile': 'Programa_PPL_Hibrido (7).xlsx',
        'sha256': sha, 'adjusted': ADJUST, 'changes': changes, 'general': general, 'blocks': blocks, 'exercises': exercises, 'weeks': weeks, 'report': rep}
json.dump(prog, open(out, 'w'), ensure_ascii=False, separators=(',', ':'))
print('\nOK ->', out, prog['id'])
