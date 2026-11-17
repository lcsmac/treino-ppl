# Treino PPL

Aplicativo web pessoal para registrar séries do Programa PPL Híbrido. Funciona no iPhone pelo ícone da Tela de Início e sem conexão.

## Como publicar (gratuito, GitHub Pages)
1. Crie um repositório no GitHub e envie esta pasta.
2. Em Settings > Pages, escolha "Deploy from a branch", branch `main`, pasta `/docs`.
3. No iPhone, abra o endereço no Safari, toque em Compartilhar > Adicionar à Tela de Início e use sempre pelo ícone.

O endereço não pode mudar depois: os registros ficam presos a ele. Faça backup pelo menu (☰) com frequência.

## Desenvolvimento
- `python3 tools/convert.py tools/Programa_PPL_Hibrido_7.xlsx docs/program.json` converte a planilha e confere as contagens (falha se algo não bater).
- `node --test tests/logic.test.mjs` roda os testes das regras.
- Para ver no computador: `python3 -m http.server 8000 --directory docs`.
