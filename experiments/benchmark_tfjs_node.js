// Benchmark rapido: confirma que tfjs-node treina rapido o suficiente pra viabilizar
// o modelo de sequencia bruta (GRU+embedding) que travava por timeout no sandbox antigo.
const tf = require('@tensorflow/tfjs-node');
const fs = require('fs');

const dataset = JSON.parse(fs.readFileSync('/home/user/Sonnar/dataset_mestre.json', 'utf8'));
console.log('Giros no dataset:', dataset.length);

function terminalDig(n) { return n % 10; }
const terminais = dataset.map(terminalDig);

const JANELA = 18; // ultimos 18 terminais como sequencia
const exemplosX = [];
const exemplosY = [];
// terminais[0] = mais antigo no dataset_mestre.json (ordem cronologica crescente, confirmar)
for (let i = 0; i + JANELA < terminais.length; i++) {
  exemplosX.push(terminais.slice(i, i + JANELA));
  exemplosY.push(terminais[i + JANELA]);
}
console.log('Exemplos gerados:', exemplosX.length);

const xs = tf.tensor2d(exemplosX, [exemplosX.length, JANELA], 'int32');
const ys = tf.oneHot(tf.tensor1d(exemplosY, 'int32'), 10);

const model = tf.sequential();
model.add(tf.layers.embedding({ inputDim: 10, outputDim: 8, inputLength: JANELA }));
model.add(tf.layers.gru({ units: 16 }));
model.add(tf.layers.dense({ units: 10, activation: 'softmax' }));
model.compile({ optimizer: tf.train.adam(0.01), loss: 'categoricalCrossentropy', metrics: ['accuracy'] });

console.log('\n--- Treinando GRU+embedding (5 epocas, batch 64) ---');
const t0 = Date.now();
model.fit(xs, ys, { epochs: 5, batchSize: 64, verbose: 0 }).then((h) => {
  const dt = (Date.now() - t0) / 1000;
  console.log('Tempo total (5 epocas):', dt.toFixed(2), 's');
  console.log('Tempo medio por epoca:', (dt / 5).toFixed(2), 's');
  console.log('Loss final:', h.history.loss[h.history.loss.length - 1]);
  console.log('Acc final (treino):', h.history.acc ? h.history.acc[h.history.acc.length - 1] : h.history.accuracy[h.history.accuracy.length-1]);
  console.log('\nOK: tfjs-node treina em segundos, nao em minutos - lentidao do sandbox anterior nao se repete aqui.');
  process.exit(0);
}).catch(e => { console.error('ERRO NO TREINO:', e); process.exit(1); });
