# Míng T123 Tracker — Briefing para continuação no Claude Code

## O que é este projeto
App único em HTML/JS puro (arquivo `ming_t123.html`, ~4.500+ linhas), rodando 100% no navegador, sem servidor. É um sistema de análise estatística e ML para roleta ao vivo (Roleta Brasileira, Pragmatic Play). Ricardo é o dono do produto e fornecedor de dados ao vivo; o desenvolvimento é feito com extremo rigor estatístico.

## REGRAS METODOLÓGICAS QUE NUNCA PODEM SER QUEBRADAS
1. **Nunca pool milhares de giros como se fosse uma amostra só.** Sempre testar sessão por sessão (janela curta, tipicamente 100-250 giros), ou usar validação por múltiplas janelas de tempo respeitando ordem cronológica.
2. **Sempre testar antes de implementar.** Nenhuma mudança entra sem rodar com dado real primeiro e mostrar o resultado.
3. **Nunca fechar uma investigação sem confirmação explícita do Ricardo**, mesmo quando o resultado é nulo.
4. **Correção por múltiplas comparações (FDR/Bonferroni) sempre que testar vários candidatos ao mesmo tempo** — já pegamos vários "achados" que eram só efeito de múltiplos testes (ex: T1→T0).
5. **Ceticismo com atraso/"devendo sair"** — testamos hazard curves várias vezes, são sempre planas. Gambler's fallacy é tratado com rigor e recusado, mesmo quando reformulado de jeito diferente.
6. **Toda mudança de código precisa ser testada em Node.js simulando o motor real antes de entregar** — extrair o `<script>` do HTML, rodar com dado real, confirmar comportamento, só depois dar por pronto.

## Onde estão os dados
- `dataset_mestre.json` — dataset acumulado principal (~11.365 giros na última contagem). Usar `gerenciar_dataset.py` pra adicionar novos lotes (tem dedup automático por sobreposição).
- `gerenciar_dataset.py` — funções `carregar_mestre()`, `salvar_mestre()`, `find_overlap()`, `carregar_log()`, `salvar_log()`.
- `dataset_mestre_log.json` — histórico de cada lote adicionado.
- Dentro do próprio app: "arquivo permanente" (`historicoArquivoPermanente`, chave localStorage `mingArquivoPermanente`) — cresce sozinho conforme Ricardo joga, nunca é limpo pelo Reset, tem botão de Exportar.

## Arquitetura atual do app

### Motores clássicos (Trend, Sniper, Trigger, Diagonal, Paridade)
- **Trend Detector**: torneio de candidatos A-G competindo. Destaques: Candidato E ("4→Dúzia", achado mais forte do projeto, 93.9% em 33 amostras) e F ("29→Dúzia"), ambos com torneio interno de 3 sub-candidatos (DZ12/13/23) via CUSUM duplo. **Correção recente**: antes de E/F vencerem automático com confiança 0.999, agora checam se o Candidato G (frequência ao vivo) contradiz — se contradisser, entram no torneio competitivo normal em vez de vencer sempre.
- **Drift-Cor**: **REMOVIDO** (feito no Claude Code). Prediz Cor (vermelho/preto), confirmado fraco em exaustivos testes (50.5% real vs 48.6% baseline — sem edge). Motor inteiro (`analisarDrift`, CUSUM, corta-circuito, box "Successor Drift" e toda UI/estado associados) tirado do `ming_t123.html`; o box do Trigger (`g-lei`) agora ocupa o espaço que sobrou no layout (linhas 1-2 da coluna 4). Testado em Node com dado real + visualmente no browser, sem erros. `gestaoModoEAposta` perdeu a condição de "modo conservador" baseada no CUSUM do Drift; `atualizarMonitorTendencia` voltou a usar 100% do Trend.
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
1. ~~Matar o Drift-Cor e rearranjar os boxes do layout~~ — **feito no Claude Code**, ver seção de motores acima.
2. **Corrigir a mistura de dados no reforço estrutural original** (a versão de 8 features com DZ/Col+Cor misturados) — foi abandonada em favor da versão de 4 features (Cor trocada por Alto/Baixo), que já funciona bem. Pode não ser mais necessário revisitar, mas ficou em aberto formalmente.
3. **Auto-aprendizagem pro modelo de janelas 3/5/7** — hoje só o candidato Estrutural tem botão de retreino. O modelo ML 3/5/7 continua com pesos fixos de quando foi treinado 1x offline em Python.
4. **Meta-modelo de arbitragem entre os 3 candidatos do torneio** — testamos rápido e achamos sinal real ("número de candidatos aprovados" e "momentum" correlacionam com acerto — isso virou o indicador 🔥🟢🟡🔴), mas nunca foi além de um teste rápido. Pode ter mais a explorar num modelo de verdade que aprenda a combinar os 3.

## TESTES QUE TRAVARAM NO SANDBOX ANTIGO — RETOMADOS NO CLAUDE CODE (resultados abaixo, NENHUM confirmado/fechado por Ricardo ainda)

O sandbox antigo tinha rede restrita e rodava TensorFlow.js sem o binário nativo (`tfjs-node`), deixando tudo baseado em rede neural extremamente lento. No Claude Code isso NÃO é problema: `tfjs-node` instala normalmente (`npm install @tensorflow/tfjs-node`, backend nativo confirmado, ~11s/época mesmo com dataset completo de ~11.3k giros — nada a ver com os timeouts de antes). Os 4 itens abaixo foram retestados de verdade contra `dataset_mestre.json`. Scripts e resultados brutos ficam em `experiments/`.

1. **Sequência bruta via GRU+embedding pro Terminal Radar** (`experiments/gru_sequencia_terminal.js`, resultado em `resultado_gru_sequencia.json`). Embedding+GRU sobre os últimos 18 terminais, walk-forward em 5 janelas cronológicas (nunca pool tudo como amostra única). **Resultado: nulo.** Top-3 médio 32.1% vs 32.6% do baseline de frequência simples (sem vazamento) — só bateu o baseline em 1 dos 5 folds. Bate com o achado já refutado "Relação entre terminais". **Ainda não confirmado como refutado por Ricardo.**

2. **Modelo de regime Dúzia/Coluna original (GRU+embedding+features de domínio)** (`experiments/gru_regime_duzia_coluna.js`, resultado em `resultado_gru_regime_duzia_coluna.json`). Ramo GRU (sequência de 15 giros) + ramo Dense (freq/atraso/EWMA) combinados, aposta no par das 2 categorias mais prováveis (mesma lógica do Trend), walk-forward 5 folds. **A instabilidade de 45-60% do sandbox antigo sumiu** (desvio agora de só 0.7-0.8pp entre folds — confirma que era falta de poder computacional, não sinal instável de verdade). Mas o resultado estável (Dúzia 67.3%, Coluna 67.7%) fica **empatado com um baseline de frequência simples** (67.0%/66.7%) e **abaixo do Trend real em produção** (68.9%) — sem edge incremental que justifique usar. **Ainda não confirmado como refutado por Ricardo.**

3. **Validação cruzada mais extensa** nos modelos já validados (`experiments/validacao_cruzada_extensa.js` + `validacao_ml357_corrigida.js`, resultados em `resultado_validacao_cruzada_extensa.json` e `resultado_ml357_janelas_corrigido.json`). Rodou o motor REAL extraído do HTML (não uma reimplementação), giro a giro, numa sessão contínua simulada:
   - **ML 3/5/7**: 20 janelas cronológicas cobrindo o dataset inteiro (11.358 chamadas). Média 32.9%, desvio de só 2.0pp entre janelas, mínimo 29.8%/máximo 36.4% — **todas as janelas acima do baseline, resultado praticamente idêntico ao já documentado (32.8%, p<0.0001) e agora com muito mais confiança estatística.** Primeira tentativa desse teste tinha um bug (lia o log truncado em 200 entradas, cobrindo só os últimos giros) — corrigido usando o contador cumulativo.
   - **Estrutural**: 15 checkpoints de retreino AO VIVO (via `retreinarModeloEstrutural()`, a mesma função do botão "🧠 Retreinar", sem reimplementar nada). A acurácia balanceada do treino (`valAcc`) ficou estável em ~69% em 14 dos 15 folds, **confirmando o 68-69% já documentado** — mas o **fold 7 colapsou pra 34.0%** nesse retreino específico (causa não investigada: pode ser seed ruim ou desbalanceamento pontual naquela janela de dados). Achado novo: o top-3 hit-rate do candidato Estrutural **sozinho** (fora do torneio) ficou em 28.5% médio, perto do baseline de ~30% — bem mais fraco do que os 68-69% de acurácia balanceada, porque são métricas diferentes (accuracy binária balanceada de treino vs. hit-rate de ranking top-3 em uso real). Não invalida o Torneio combinado (70-79%, que já é o que decide a call oficial), mas sugere que o Estrutural sozinho contribui menos pro ranking do que a acurácia de treino sugeria. **Nenhum dos dois achados novos (fold 7 e top-3 fraco isolado) foi investigado a fundo nem confirmado por Ricardo.**

4. **Buscar um dataset ainda maior antes de re-treinar** — perguntado direto ao Ricardo: **não existe mais dado real disponível hoje** (11.365 giros é o total). Pendência sem ação possível no momento — não fabricar dado sintético.

## Coisas técnicas úteis pra saber
- `getCor(n)` retorna `'red'`/`'black'` (inglês), não `'vermelho'`/`'preto'` — já causou bug 1x.
- `historicoTotal[0]` = giro mais recente (newest-first).
- Extrair o script pra testar: `content.split('<script>',1)[1].rsplit('</script>',1)[0]`.
- Simular o motor em Node exige mockar `document`, `localStorage`, `confirm`, `alert`, `Blob`, `URL` (ver qualquer teste anterior no histórico como modelo).
- `executarConciliador()` roda scanners pesados (Ondas/Trigger automático) que deixam rodar 11k giros lento. Pra testes que não precisam disso, chamar as funções específicas direto (`atualizarTerminalRadar`, `analisarTrend`) em vez do pipeline completo.
- No Claude Code o motor real inteiro roda giro a giro contra `dataset_mestre.json` em segundos, não minutos (`tfjs-node` funciona, sem limite de ~250s por comando) — ver `experiments/` pra scripts prontos de walk-forward/validação cruzada que reusam esse padrão (extrai `<script>`, mocka `document`/`localStorage`/`confirm`/`alert`/`Blob`/`URL`, roda tudo num único `vm.runInThisContext` pra variáveis `let`/`const` de topo ficarem acessíveis ao driver).
- `experiments/` guarda os scripts e resultados (JSON) de cada teste retomado nesta sessão — ver seção "TESTES QUE TRAVARAM" acima.

## Como Ricardo se comunica (calibragem de tom)
- Direto, sem rodeio, espera respostas objetivas.
- Não gosta de explicação repetida ou cautela repetitiva depois de já ter sido avisado 1x.
- Aprecia quando o assistente pega erro próprio e corrige com transparência, sem drama.
- Prefere "teste rápido, sem estender" quando pede validação adicional — cuidado pra não gastar esforço demais em explorações abertas.
- Se importa genuinamente com regras (nunca aceita gambler's fallacy disfarçado), então vale a pena manter esse padrão de rigor sempre.
