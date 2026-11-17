const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 13'], locale: 'pt-BR', serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.goto('http://localhost:8765/'); await p.waitForSelector('.exname');
  const shot = n => p.screenshot({ path: `/tmp/claude-0/shots/${n}.png` });
  await shot('1-abertura');
  const txt = async s => (await p.locator(s).innerText()).replace(/\s+/g, ' ');
  console.log('abertura:', await txt('#top .prog'), '|', await txt('.stats'), '|', await txt('.cmp'));
  // registra série 1 e 2 do primeiro exercício (semana 1 Pull A)
  await p.fill('#load', '40'); await p.fill('#val', '10'); await p.click('.reg');
  console.log('após registrar 1:', await txt('#top .prog'), '| sel:', await p.locator('.sets .sel').innerText());
  await p.fill('#val', '9'); console.log('carga sugerida:', await p.inputValue('#load'), await p.locator('#load').getAttribute('class'));
  await p.click('.reg'); console.log('após registrar 2:', await txt('#top .prog'), '|', await p.inputValue('#selOpt'), await p.locator('#selOpt option:checked').innerText());
  await shot('2-segundo-exercicio');
  // consultar outro treino não muda posição; recarregar retoma
  await p.selectOption('#selType', 'Legs B'); await p.reload(); await p.waitForSelector('.exname');
  console.log('retomada:', await p.locator('#selType option:checked').innerText(), await p.locator('#selLine option:checked').innerText(), await p.locator('.sets .sel').innerText());
  // alternativa: trocar e voltar mantém dados
  await p.selectOption('#selOpt', '1'); console.log('alt vazia:', JSON.stringify(await p.inputValue('#val')), await txt('.tag.alt'));
  await p.selectOption('#selOpt', '0'); await p.click('.sets button:nth-child(1)'); console.log('principal mantém:', await p.inputValue('#load'), await p.inputValue('#val'));
  // semana 2: comparação
  await p.selectOption('#selWeek', '2'); await p.selectOption('#selType', 'Pull A'); await p.click('.sets button:nth-child(1)');
  console.log('comparação sem.2:', await txt('.cmp'));
  // semana 4 opcional + supersérie
  await p.selectOption('#selWeek', '4'); await p.selectOption('#selType', 'Legs A');
  await p.selectOption('#selLine', { index: 2 }); await shot('3-superserie-opcional');
  await p.check('.optbox input'); console.log('opcional ligada:', await p.locator('.sets button').count(), 'séries;', await txt('.stats'));
  await shot('4-opcional-ligada');
  await p.click('[data-act=menu]'); await p.waitForSelector('dialog[open]'); await shot('5-menu');
  console.log('erros:', errs.length ? errs : 'nenhum');
  await b.close();
})();
