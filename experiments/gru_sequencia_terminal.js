// Retomada do teste "sequencia bruta via GRU+embedding pro Terminal Radar" (pendencia #1 do
// BRIEFING_PROJETO.md - travava por timeout no sandbox antigo sem tfjs-node). Agora com o
// binario nativo instalado, roda de verdade contra os ~11.3k giros do dataset_mestre.json.
//
// Metodologia (regra do projeto: nunca pool tudo como amostra unica; validar em multiplas
// janelas de tempo respeitando ordem cronologica):
// - Walk-forward em 5 folds: treina em tudo ANTES da janela de teste (expanding window),
//   nunca usa dado futuro pra prever o passado.
// - Metrica: top-3 hit rate (mesmo criterio ja usado pros candidatos ML 3/5/7 e Estrutural
//   no app - baseline ~30%, ja validado com 32.8% real p<0.0001 pro candidato ML 3/5/7).
// - Modelo do zero em cada fold (sem vazamento entre folds).
const tf = require('@tensorflow/tfjs-node');
const fs = require('fs');

const dataset = JSON.parse(fs.readFileSync('/home/user/Sonnar/dataset_mestre.json', 'utf8'));
function terminalDig(n) { return n % 10; }
const terminais = dataset.map(terminalDig);

const JANELA = 18;
const X = [], Y = [];
for (let i = 0; i + JANELA < terminais.length; i++) {
  X.push(terminais.slice(i, i + JANELA));
  Y.push(terminais[i + JANELA]);
}
console.log('Total de exemplos (cronologicos):', X.length);

const N_FOLDS = 5;
const chunkSize = Math.floor(X.length / (N_FOLDS + 1));
console.log('Tamanho de cada chunk (~1/6 do dataset):', chunkSize);

function top3Acc(model, xTest, yTest) {
  const xs = tf.tensor2d(xTest, [xTest.length, JANELA], 'int32');
  const probs = model.predict(xs).arraySync();
  xs.dispose();
  let hits = 0;
  for (let i = 0; i < probs.length; i++) {
    const idx = probs[i].map((p, t) => [p, t]).sort((a, b) => b[0] - a[0]).slice(0, 3).map(x => x[1]);
    if (idx.includes(yTest[i])) hits++;
  }
  return hits / xTest.length;
}

function criarModelo() {
  const model = tf.sequential();
  model.add(tf.layers.embedding({ inputDim: 10, outputDim: 8, inputLength: JANELA }));
  model.add(tf.layers.gru({ units: 24 }));
  model.add(tf.layers.dense({ units: 10, activation: 'softmax' }));
  model.compile({ optimizer: tf.train.adam(0.01), loss: 'categoricalCrossentropy' });
  return model;
}

async function rodarFolds() {
  const resultados = [];
  const t0global = Date.now();
  for (let f = 1; f <= N_FOLDS; f++) {
    const treinoFim = f * chunkSize;
    const testeIni = treinoFim;
    const testeFim = Math.min(X.length, testeIni + chunkSize);

    const xTreino = X.slice(0, treinoFim);
    const yTreino = Y.slice(0, treinoFim);
    const xTeste = X.slice(testeIni, testeFim);
    const yTeste = Y.slice(testeIni, testeFim);

    const xs = tf.tensor2d(xTreino, [xTreino.length, JANELA], 'int32');
    const ys = tf.oneHot(tf.tensor1d(yTreino, 'int32'), 10);

    const model = criarModelo();
    const t0 = Date.now();
    await model.fit(xs, ys, { epochs: 12, batchSize: 128, verbose: 0 });
    const dt = (Date.now() - t0) / 1000;

    const acc = top3Acc(model, xTeste, yTeste);

    // baseline: taxa esperada escolhendo os 3 terminais mais frequentes NO TREINO (nao no teste -
    // sem vazamento), aplicado como previsao FIXA em todo o teste (baseline "burro" de frequencia)
    const freq = new Array(10).fill(0);
    yTreino.forEach(t => freq[t]++);
    const top3Fixo = freq.map((c, t) => [c, t]).sort((a, b) => b[0] - a[0]).slice(0, 3).map(x => x[1]);
    const baselineHits = yTeste.filter(t => top3Fixo.includes(t)).length / yTeste.length;

    resultados.push({
      fold: f, treino: xTreino.length, teste: xTeste.length,
      tempoTreinoSeg: dt.toFixed(1), acc, baselineHits
    });

    console.log(`Fold ${f}: treino=${xTreino.length} teste=${xTeste.length} tempo=${dt.toFixed(1)}s | GRU top-3=${(acc*100).toFixed(1)}% | baseline freq top-3=${(baselineHits*100).toFixed(1)}%`);

    xs.dispose(); ys.dispose();
    model.dispose ? model.dispose() : null;
  }

  const dtTotal = (Date.now() - t0global) / 1000;
  console.log('\n=== RESUMO ===');
  console.log('Tempo total:', dtTotal.toFixed(1), 's');
  const media = resultados.reduce((s, r) => s + r.acc, 0) / resultados.length;
  const mediaBaseline = resultados.reduce((s, r) => s + r.baselineHits, 0) / resultados.length;
  console.log('Media GRU top-3:', (media*100).toFixed(1) + '%');
  console.log('Media baseline (freq fixa) top-3:', (mediaBaseline*100).toFixed(1) + '%');
  console.log('Baseline teorico (30%, mesmo dos outros candidatos):  30.0%');
  console.log('\nFolds em que o GRU bateu o baseline de frequencia:', resultados.filter(r => r.acc > r.baselineHits).length, '/', resultados.length);

  fs.writeFileSync('/home/user/Sonnar/experiments/resultado_gru_sequencia.json', JSON.stringify(resultados, null, 2));
  console.log('\nResultado salvo em experiments/resultado_gru_sequencia.json');
}

rodarFolds().catch(e => { console.error('ERRO:', e); process.exit(1); });
