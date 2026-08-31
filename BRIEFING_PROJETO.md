# Míng T123 Tracker — Briefing para continuação no Claude Code

## O que é este projeto
App único em HTML/JS puro (arquivo `ming_t123.html`, ~4.500+ linhas), rodando 100% no navegador, sem servidor. É um sistema de análise estatística e ML para roleta ao vivo (Roleta Brasileira, Pragmatic Play). Ricardo é o dono do produto e fornecedor de dados ao vivo; o desenvolvimento é feito com extremo rigor estatístico.

## REGRAS METODOLÓGICAS QUE NUNCA PODEM SER QUEBRADAS
1. **Nunca pool milhares de giros como se fosse uma amostra só.** Sempre testar sessão por sessão (janela curta, tipicamente 100-250 giros), ou usar validação por múltiplas janelas de tempo respeitando ordem cronológica.
2. **Sempre testar antes de implementar.** Nenhuma mudança entra sem rodar com dado real primeiro e mostrar o resultado.
3. **Nunca fechar uma investigação sem confirmação explícita do Ricardo**, mesmo quando o resultado é nulo.
4. **Correção por múltiplas comparações (FDR/Bonferroni) sempre que testar vários candidatos ao mesmo tempo** — já pegamos vários "achados" que eram só efeito de múltiplos testes (ex: T1→T0).
5. **Ceticismo com atraso/"devendo sair"** — testamos hazard curves várias vezes, são sempre planas. Gambler's fallacy é tratado com rigor e recusado, mesmo quando reformulado de jeito diferente.
6. **Toda mudança de código precisa ser testada em Node.js simulando o motor real antes de entregar** — extrair o `<script>` do HTML, rodar com dado real, confirmar comportamento, só depois copiar pra `/mnt/user-data/outputs/`.

## Onde estão os dados
- `dataset_mestre.json` — dataset acumulado principal (~11.365 giros na última contagem). Usar `gerenciar_dataset.py` pra adicionar novos lotes (tem dedup automático por sobreposição).
- `gerenciar_dataset.py` — funções `carregar_mestre()`, `salvar_mestre()`, `find_overlap()`, `carregar_log()`, `salvar_log()`.
- `dataset_mestre_log.json` — histórico de cada lote adicionado.
- Dentro do próprio app: "arquivo permanente" (`historicoArquivoPermanente`, chave localStorage `mingArquivoPermanente`) — cresce sozinho conforme Ricardo joga, nunca é limpo pelo Reset, tem botão de Exportar.

## Arquitetura atual do app

### Motores clássicos (Trend, Drift, Sniper, Trigger, Diagonal, Paridade)
- **Trend Detector**: torneio de candidatos A-G competindo. Destaques: Candidato E ("4→Dúzia", achado mais forte do projeto, 93.9% em 33 amostras) e F ("29→Dúzia"), ambos com torneio interno de 3 sub-candidatos (DZ12/13/23) via CUSUM duplo. **Correção recente**: antes de E/F vencerem automático com confiança 0.999, agora checam se o Candidato G (frequência ao vivo) contradiz — se contradisser, entram no torneio competitivo normal em vez de vencer sempre.
- **Drift-Cor**: prediz Cor (vermelho/preto). **CONFIRMADO FRACO DEPOIS DE EXAUSTIVOS TESTES** (50.5% real vs 48.6% baseline — sem edge). Testamos: frequência simples, atraso, CUSUM, ML multi-janela (3/5/7), ML com horizonte, reforço estrutural invertido (terminal→cor), geometria da mesa (diagonais físicas). Todos nulos. **Ricardo já decidiu matar esse motor — combinado fazer isso "na próxima atualização", ainda não foi feito.** Quando for feito: seguir o mesmo processo usado pra aposentar o T Míng antigo (remover do fluxo, testar que nada quebra, e **rearranjar os boxes** do layout pra ocupar o espaço vazio).
- **Sniper**: mudou de "2 de 3 categorias" pra "3 EWMA alinhados >70%" (Coluna, Dúzia, Terminal). Terminal com corte mais baixo (44%, ajustado pelo baseline menor).
- **Trigger, Diagonal, Paridade**: motores auxiliares, funcionando, sem pendência aberta.

### Terminal Radar (a parte mais nova e mais testada)
Substituiu o T Míng antigo. Três candidatos competindo em torneio:
1. **EWMA/CUSUM** — frequência recente por terminal (pacote de 4). Baseline ~40%.
2. **ML janelas 3/5/7** — rede neural pequena (pesos fixos, treinados 1x offline, embutidos no HTML como `MODELO_TERMINAL_PESOS`). Usa frequência dos terminais em janelas de 3/5/7 giros. Validado: top-3 = 32.8% vs 30% esperado, p<0.0001. Baseline ~30%.
3. **Estrutural** — o mais forte (68-69% de acurácia balanceada validada). Usa: se terminal está estruturalmente ligado (matematicamente) a Dúzia/Coluna favorecida, ou (pra terminais 0,7,8,9) a Alto/Baixo favorecido (trocamos de Cor pra Alto/Baixo por pedido do Ricardo — ele não confia em Cor). Tem **auto-aprendizagem real**: botão "🧠 Retreinar" no app treina uma rede pequena (4 features) do zero usando todo o arquivo permanente, direto no navegador (JS puro, sem TensorFlow), ~10s por 3.000 giros. Achado importante: esse modelo **satura em ~330 giros** — mais dado depois disso não muda a previsão nem um pouco (testado até 62.000 exemplos, previsões idênticas).

**Torneio (função `rodarTorneioTerminal`)**: só concorre quem tem edge real comprovado (EWMA de acerto > baseline + margem). Entre aprovados, vence quem tem a janela rápida (últimas 10 calls) mais forte agora. Indicador de confiança combinado:
- 🔥 = momentum (últimas 10) ≥ 90% → validado: 84.9% de acerto real (n=2843)
- 🟢 = 3 candidatos aprovados E momentum ≥ 50%
- 🟡 = 2 aprovados, ou momentum 50-90%
- 🔴 = 1 aprovado com momentum baixo

Sequência G/R visível no painel (Ricardo se importa mais com a sequência/streak do que só a % agregada). Função `sequenciaGR()`, `maiorSequenciaR()`.

## Achados validados (tratar como reais, mas continuar monitorando)
- **Coluna 2**: 38.3% vs 32.4% baseline, p=0.0029, 5 sessões independentes consistentes.
- **14→Coluna 1**: p=0.0053, 6 de 7 sessões.
- **Candidato E (4→DZ12)**: 93.9% em 33 amostras, replicado em 3 mesas.
- **Candidato F (29→DZ13)**: 81.6%, direção consistente em 4 mesas.
- **Terminal Radar - Estrutural**: 68-69% de acurácia balanceada, estável em múltiplas janelas de tempo (desvio <1pp).
- **Terminal Radar - Torneio combinado**: 70-79% de acerto real, dependendo da sessão testada.

## Achados refutados (não reabrir sem motivo novo)
- Cor/Drift-Cor: nulo em todos os ângulos testados (ver acima).
- Terminal isolado (CUSUM/EWMA sozinho, sem contexto): ~50%, zero sinal.
- Relação entre terminais (frequência conjunta prevendo próximo terminal): nulo em 4 tamanhos de janela.
- Casa+3/Casa+5, Casa+4/Casa+5 após zero: nulo, testado 2x com amostras diferentes.
- T1→T0 terminal transition: artefato de multiple comparisons, não sobrevive ao scanner genérico de 90 combinações.
- Vizinhança física na roda: nulo (testado pro número 6, pro T9, e geometria de diagonais da mesa).
- T Míng, Anti-Míng, Setor 4 rotativo: aposentados/não confirmados.

## PENDÊNCIAS EXPLÍCITAS (ainda não feitas)
1. **Matar o Drift-Cor** e **rearranjar os boxes do layout** — combinado fazer "na próxima atualização". Ricardo já deu sinal verde, só não fizemos ainda.
2. **Corrigir a mistura de dados no reforço estrutural original** (a versão de 8 features com DZ/Col+Cor misturados) — foi abandonada em favor da versão de 4 features (Cor trocada por Alto/Baixo), que já funciona bem. Pode não ser mais necessário revisitar, mas ficou em aberto formalmente.
3. **Auto-aprendizagem pro modelo de janelas 3/5/7** — hoje só o candidato Estrutural tem botão de retreino. O modelo ML 3/5/7 continua com pesos fixos de quando foi treinado 1x offline em Python.
4. **Meta-modelo de arbitragem entre os 3 candidatos do torneio** — testamos rápido e achamos sinal real ("número de candidatos aprovados" e "momentum" correlacionam com acerto — isso virou o indicador 🔥🟢🟡🔴), mas nunca foi além de um teste rápido. Pode ter mais a explorar num modelo de verdade que aprenda a combinar os 3.

## TESTES QUE TRAVARAM AQUI POR LIMITAÇÃO TÉCNICA (não por falta de sinal - reavaliar no Claude Code)

Este ambiente sandbox tem rede restrita (só alguns domínios de pacotes liberados) e roda TensorFlow.js sem o binário nativo (`tfjs-node`), o que deixou tudo baseado em rede neural **extremamente lento** pra qualquer dataset de verdade. Isso bloqueou ou limitou os seguintes testes — no Claude Code, rodando local, isso deixa de ser um problema:

1. **Sequência bruta via GRU+embedding pro Terminal Radar.** Tentamos treinar um modelo que olha os últimos 15-20 terminais como sequência (não como frequência agregada) pra prever o próximo terminal, com embedding+GRU. Deu timeout repetidamente mesmo reduzindo o tamanho da rede — o TF.js puro em Node é ordens de magnitude mais lento que com o binário nativo. **Nunca conseguimos rodar isso de verdade com volume real de dado.** Vale reativar essa tentativa específica no Claude Code, instalando `tfjs-node` (o motivo de não instalar aqui: precisa baixar de `storage.googleapis.com`, domínio bloqueado nessa rede sandbox — no Claude Code local isso não deveria ser problema).

2. **Modelo de regime Dúzia/Coluna original (GRU+embedding+features de domínio)** — o primeiro modelo que tentamos no projeto, antes do Terminal Radar existir. Testamos com 1.989 e depois 4.460 exemplos, sempre com muita instabilidade entre rodadas (variando de 45% a 60%, sem convergir). Isso pode ter sido parcialmente **arquitetura genuinamente sem sinal suficiente**, mas também pode ter sido limitado pela lentidão do treino em JS puro nos impedindo de rodar validação cruzada mais extensa (mais épocas, mais seeds, tuning de hiperparâmetro) pra saber se estabilizaria com mais tentativas. Vale re-testar com mais poder computacional antes de considerar definitivamente encerrado.

3. **Validação cruzada mais extensa em geral** — qualquer teste aqui que rodou "5 janelas de tempo" ou "3 seeds" foi limitado a esse número pequeno por causa do tempo de execução (limite de ~250s por comando neste ambiente). No Claude Code, rodar 10-20 janelas/seeds pra qualquer um dos modelos já validados (Estrutural, janelas 3/5/7) daria mais confiança estatística sobre a estabilidade real.

4. **Buscar um dataset ainda maior antes de re-treinar** — como descobrimos que o modelo Estrutural satura em ~330 giros, isso não é mais prioridade pra ELE especificamente. Mas se o modelo de sequência bruta (item 1) for retomado, ele pode se beneficiar de muito mais dado do que os ~11k giros atuais, e essa arquitetura mais complexa não necessariamente satura tão cedo quanto a de 4 features.

## Coisas técnicas úteis pra saber
- `getCor(n)` retorna `'red'`/`'black'` (inglês), não `'vermelho'`/`'preto'` — já causou bug 1x.
- `historicoTotal[0]` = giro mais recente (newest-first).
- Extrair o script pra testar: `content.split('<script>',1)[1].rsplit('</script>',1)[0]`.
- Simular o motor em Node exige mockar `document`, `localStorage`, `confirm`, `alert`, `Blob`, `URL` (ver qualquer teste anterior no histórico como modelo).
- `executarConciliador()` roda scanners pesados (Ondas/Trigger automático) que deixam rodar 11k giros lento (~timeout de 250s). Pra testes que não precisam disso, chamar as funções específicas direto (`atualizarTerminalRadar`, `analisarTrend`, `analisarDrift`) em vez do pipeline completo.
- Sempre copiar o arquivo final pra `/mnt/user-data/outputs/ming_t123.html` e usar `present_files` antes de considerar entregue.

## Como Ricardo se comunica (calibragem de tom)
- Direto, sem rodeio, espera respostas objetivas.
- Não gosta de explicação repetida ou cautela repetitiva depois de já ter sido avisado 1x.
- Aprecia quando o assistente pega erro próprio e corrige com transparência, sem drama.
- Prefere "teste rápido, sem estender" quando pede validação adicional — cuidado pra não gastar esforço demais em explorações abertas.
- Se importa genuinamente com regras (nunca aceita gambler's fallacy disfarçado), então vale a pena manter esse padrão de rigor sempre.
