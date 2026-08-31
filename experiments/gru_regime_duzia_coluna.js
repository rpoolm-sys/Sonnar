// Retomada do teste "Modelo de regime Dúzia/Coluna original (GRU+embedding+features de
// dominio)" - pendencia #2 do BRIEFING_PROJETO.md. No sandbox antigo, com 1.989 e depois
// 4.460 exemplos, deu muita instabilidade entre rodadas (45%-60%, sem convergir) - nunca
// ficou claro se era falta de sinal real ou so falta de poder computacional pra rodar mais
// epocas/seeds/validacao cruzada. Com tfjs-node instalado, refaz o teste com os ~11.3k giros
// reais do dataset_mestre.json e validacao cronologica adequada.
//
// Arquitetura: 2 ramos combinados (igual a descricao original "GRU+embedding+features de
// dominio"):
//   Ramo A (sequencia bruta): embedding da duzia/coluna dos ultimos 15 giros -> GRU
//   Ramo B (features de dominio, mesmo estilo do Trend/Estrutural ja usados no app):
//     frequencia em janela de 40, atraso (giros desde ultima saida), EWMA (alpha=0.1)
//     de cada uma das 3 categorias
// Saida: softmax 3 classes (qual das 3 duzias/colunas sai no proximo giro, giros com zero
// sao pulados - mesma convencao do resto do app, que trata 'green'/duzia 0 como sem dado)
//
// Metrica: pra comparar com o Trend (unico motor com edge validado hoje, 68.9% vs baseline
// 64.9% em >500 giros), o modelo tambem aposta no PAR das 2 duzias/colunas mais provaveis
// (mesma logica de aposta real do Trend) e mede hit rate contra o mesmo baseline de 64.9%.
//
// Walk-forward em 5 folds cronologicos (expanding window, sem vazamento), mesma metodologia
// do teste da sequencia de terminais - nunca pool tudo como amostra unica.
const tf = require('@tensorflow/tfjs-node');
const fs = require('fs');

const dataset = JSON.parse(fs.readFileSync('/home/user/Sonnar/dataset_mestre.json', 'utf8'));
function duzia(n) { if (n === 0) return 0; return Math.ceil(n / 12); }
function coluna(n) { if (n === 0) return 0; const r = n % 3; return r === 0 ? 3 : r; }

const JANELA = 15;
const JANELA_FREQ = 40;
const EWMA_ALPHA = 0.1;

function construirExemplos(catFn) {
  // catFn(n) -> 0 (zero) | 1 | 2 | 3
  const cats = dataset.map(catFn);
  const X_seq = [], X_feat = [], Y = [];

  // EWMA incremental calculado em ordem cronologica (cats[0] = giro mais antigo no dataset)
  let ewma = [0, 1/3, 1/3, 1/3]; // indices 1,2,3 usados; comeca neutro
  for (let i = 0; i < cats.length; i++) {
    // so gera exemplo quando ha janela cheia de historico ANTES desse giro e o giro atual nao e zero
    if (i >= JANELA_FREQ && cats[i] !== 0) {
      const seq = cats.slice(i - JANELA, i); // ultimos JANELA giros ANTES do alvo (pode conter 0=zero como token proprio)
      const janelaFreq = cats.slice(i - JANELA_FREQ, i);
      const feat = [];
      for (let c = 1; c <= 3; c++) {
        const freq = janelaFreq.filter(x => x === c).length / JANELA_FREQ;
        let atraso = 0;
        for (let k = i - 1; k >= Math.max(0, i - 200); k--) { if (cats[k] === c) break; atraso++; }
        feat.push(freq, Math.min(atraso / 50, 1), ewma[c]);
      }
      X_seq.push(seq);
      X_feat.push(feat);
      Y.push(cats[i] - 1); // 0,1,2 (classes 1,2,3 reindexadas)
    }
    // atualiza EWMA depois de "ver" o giro i (pra nao vazar no proprio exemplo)
    if (cats[i] !== 0) {
      for (let c = 1; c <= 3; c++) ewma[c] = ewma[c] + EWMA_ALPHA * ((cats[i] === c ? 1 : 0) - ewma[c]);
    }
  }
  return { X_seq, X_feat, Y };
}

function criarModelo() {
  const inSeq = tf.input({ shape: [JANELA] });
  const emb = tf.layers.embedding({ inputDim: 4, outputDim: 6 }).apply(inSeq); // 0=zero,1,2,3
  const gru = tf.layers.gru({ units: 24 }).apply(emb);

  const inFeat = tf.input({ shape: [9] }); // 3 categorias x (freq, atraso, ewma)
  const dFeat = tf.layers.dense({ units: 12, activation: 'relu' }).apply(inFeat);

  const merged = tf.layers.concatenate().apply([gru, dFeat]);
  const hidden = tf.layers.dense({ units: 16, activation: 'relu' }).apply(merged);
  const out = tf.layers.dense({ units: 3, activation: 'softmax' }).apply(hidden);

  const model = tf.model({ inputs: [inSeq, inFeat], outputs: out });
  model.compile({ optimizer: tf.train.adam(0.01), loss: 'categoricalCrossentropy' });
  return model;
}

function parAcertoRate(model, X_seq, X_feat, Y) {
  const xs1 = tf.tensor2d(X_seq, [X_seq.length, JANELA], 'int32');
  const xs2 = tf.tensor2d(X_feat, [X_feat.length, 9]);
  const probs = model.predict([xs1, xs2]).arraySync();
  xs1.dispose(); xs2.dispose();
  let hits = 0;
  for (let i = 0; i < probs.length; i++) {
    // par = as 2 classes com maior prob (equivalente a apostar nas 2 duzias/colunas favoritas)
    const par = probs[i].map((p, c) => [p, c]).sort((a, b) => b[0] - a[0]).slice(0, 2).map(x => x[1]);
    if (par.includes(Y[i])) hits++;
  }
  return hits / X_seq.length;
}

async function rodarExperimento(nome, catFn) {
  console.log(`\n########## REGIME: ${nome} ##########`);
  const { X_seq, X_feat, Y } = construirExemplos(catFn);
  console.log('Exemplos gerados (giros com zero excluidos):', X_seq.length);

  const N_FOLDS = 5;
  const chunkSize = Math.floor(X_seq.length / (N_FOLDS + 1));
  const resultados = [];
  const t0global = Date.now();

  for (let f = 1; f <= N_FOLDS; f++) {
    const treinoFim = f * chunkSize;
    const testeIni = treinoFim;
    const testeFim = Math.min(X_seq.length, testeIni + chunkSize);

    const xSeqTr = X_seq.slice(0, treinoFim), xFeatTr = X_feat.slice(0, treinoFim), yTr = Y.slice(0, treinoFim);
    const xSeqTe = X_seq.slice(testeIni, testeFim), xFeatTe = X_feat.slice(testeIni, testeFim), yTe = Y.slice(testeIni, testeFim);

    const xs1 = tf.tensor2d(xSeqTr, [xSeqTr.length, JANELA], 'int32');
    const xs2 = tf.tensor2d(xFeatTr, [xFeatTr.length, 9]);
    const ys = tf.oneHot(tf.tensor1d(yTr, 'int32'), 3);

    const model = criarModelo();
    const t0 = Date.now();
    await model.fit([xs1, xs2], ys, { epochs: 12, batchSize: 128, verbose: 0 });
    const dt = (Date.now() - t0) / 1000;

    const acc = parAcertoRate(model, xSeqTe, xFeatTe, yTe);

    // baseline: aposta sempre no par das 2 classes mais frequentes NO TREINO (sem vazamento)
    const freqTr = [0, 0, 0];
    yTr.forEach(c => freqTr[c]++);
    const parFixo = freqTr.map((c, i) => [c, i]).sort((a, b) => b[0] - a[0]).slice(0, 2).map(x => x[1]);
    const baselineHits = yTe.filter(c => parFixo.includes(c)).length / yTe.length;

    resultados.push({ fold: f, treino: xSeqTr.length, teste: xSeqTe.length, tempoTreinoSeg: +dt.toFixed(1), acc, baselineHits });
    console.log(`Fold ${f}: treino=${xSeqTr.length} teste=${xSeqTe.length} tempo=${dt.toFixed(1)}s | GRU par=${(acc*100).toFixed(1)}% | baseline freq par=${(baselineHits*100).toFixed(1)}% | baseline teorico=64.9%`);

    xs1.dispose(); xs2.dispose(); ys.dispose();
  }

  const dtTotal = (Date.now() - t0global) / 1000;
  const media = resultados.reduce((s, r) => s + r.acc, 0) / resultados.length;
  const mediaBaseline = resultados.reduce((s, r) => s + r.baselineHits, 0) / resultados.length;
  console.log(`\n--- Resumo ${nome} ---`);
  console.log('Tempo total:', dtTotal.toFixed(1), 's');
  console.log('Media GRU (par):', (media*100).toFixed(1) + '%');
  console.log('Media baseline (freq fixa, par):', (mediaBaseline*100).toFixed(1) + '%');
  console.log('Baseline teorico (Trend real hoje: 68.9%):  64.9% / 68.9%');
  console.log('Folds em que o GRU bateu o baseline de frequencia:', resultados.filter(r => r.acc > r.baselineHits).length, '/', resultados.length);
  console.log('Desvio padrao entre folds (estabilidade):', (Math.sqrt(resultados.reduce((s,r)=>s+(r.acc-media)**2,0)/resultados.length)*100).toFixed(1) + 'pp');

  return { nome, resultados, media, mediaBaseline };
}

(async () => {
  const resDuzia = await rodarExperimento('Dúzia', duzia);
  const resColuna = await rodarExperimento('Coluna', coluna);
  fs.writeFileSync('/home/user/Sonnar/experiments/resultado_gru_regime_duzia_coluna.json', JSON.stringify({ resDuzia, resColuna }, null, 2));
  console.log('\nResultado salvo em experiments/resultado_gru_regime_duzia_coluna.json');
})().catch(e => { console.error('ERRO:', e); process.exit(1); });
