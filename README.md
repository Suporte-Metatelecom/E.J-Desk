# E.J. Desk — Protótipo

Protótipo clicável da plataforma interna de abertura, acompanhamento e resolução de chamados de suporte técnico (M2M/IoT e BL) da Meta Telecom.

> **Protótipo visual.** Não tem login real, banco de dados nem envio de e-mail. Os dados são de exemplo e ficam só na memória do navegador. Ao recarregar a página, tudo volta ao estado inicial, exceto a foto de perfil e a preferência do menu. Nomes e e-mails da equipe foram trocados por fictícios.

## Como abrir

- **Online:** pelo link do GitHub Pages do repositório.
- **No computador:** baixe o `index.html` e abra no navegador.

É preciso internet para carregar as fontes e as bibliotecas de PDF e Excel.

## O que dá para testar

- **Ver protótipo como:** simula cada nível de acesso (Bronze → Prata → Ouro → Diamante), cada um herdando as permissões do anterior.
- **Chamados:**
  - Abertura de chamado, Painel de chamados, Relação de Chamados (ações rápidas, filtros, PDF) e Retorno com encerramento automático em 24 horas úteis.
  - O botão "Protótipo: avançar até o prazo" simula o fim do prazo.
- **Clientes:** cadastro, com bloqueio de CNPJ/CPF duplicado e unificação de clientes.
- **Incidentes:**
  - Registro de base e Registro de incidentes (3 turnos por dia).
  - Painel de incidentes 1 (operadoras), com gráfico geral.
  - Painel de incidentes 2 (plataformas).
  - Histórico de 3 meses e exportação em Excel.
  - Em Registro de base, "Protótipo: preencher exemplo" gera dados de teste.
- **Pontos em aberto:** lista do que ainda está "A decidir".

## Arquivos

| Arquivo | Para que serve |
|---|---|
| `index.html` | O protótipo inteiro (HTML, CSS e JavaScript num arquivo só) |
| `.nojekyll` | Faz o GitHub Pages publicar o arquivo sem processar |
| `README.md` | Este texto |
