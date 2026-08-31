// Retomada da pendencia #3 do BRIEFING_PROJETO.md: "validacao cruzada mais extensa em geral -
// qualquer teste que rodou 5 janelas de tempo ou 3 seeds foi limitado por tempo de execucao no
// sandbox antigo (~250s por comando). Aqui roda 15 checkpoints de retreino pro modelo Estrutural
// (validacao viva, continua, exatamente como ele funciona na pratica com o botao Retreinar) e
// 20 janelas de avaliacao pro ML 3/5/7 (modelo fixo, so precisa reavaliar - nao retreina).
//
// Roda o motor REAL extraido do ming_t123.html (nao uma reimplementacao) contra os ~11.3k giros
// do dataset_mestre.json, simulando uma sessao continua de uso: giro a giro via
// executarConciliador(), com checkpoints de retreino do Estrutural usando exatamente
// retreinarModeloEstrutural() (a mesma funcao do botao "Retreinar" no app).
const fs = require('fs');
const vm = require('vm');

const scriptPath = '/tmp/claude-0/-home-user-Sonnar/280c3aec-ef36-5a1d-81c6-3732e576445e/scratchpad/ming_script.js';
let mingScript = fs.readFileSync(scriptPath, 'utf8');
mingScript = mingScript.replace(
  "document.getElementById('novoSorteio').addEventListener('keypress',function(e){if(e.key==='Enter')adicionarSorteio();});", ''
);
mingScript = mingScript.replace(
  "document.getElementById('loteSorteio').addEventListener('keypress',function(e){if(e.key==='Enter')carregarLote();});", ''
);

class FakeElement {
  constructor(id) { this.id = id; this._innerHTML = ''; this._textContent = ''; this.value = '';
    this.classList = { add(){}, remove(){}, contains(){return false;}, toggle(){} }; }
  get innerHTML() { return this._innerHTML; } set innerHTML(v) { this._innerHTML = v; }
  get textContent() { return this._textContent; } set textContent(v) { this._textContent = v; }
  appendChild(){} removeChild(){} addEventListener(){}
}
const elements = {};
function getElementById(id) { if (!elements[id]) elements[id] = new FakeElement(id); return elements[id]; }
const localStorageStore = {};
global.document = { getElementById, createElement: () => new FakeElement('anon'), body: { appendChild(){}, removeChild(){} } };
global.localStorage = {
  getItem: k => (k in localStorageStore ? localStorageStore[k] : null),
  setItem: (k, v) => { localStorageStore[k] = String(v); },
  removeItem: k => { delete localStorageStore[k]; }
};
global.confirm = () => true;
global.alert = () => {};
global.Blob = function () {};
global.URL = { createObjectURL: () => 'blob://fake', revokeObjectURL: () => {} };
global.window = global;
global.fs = fs;

const dataset = JSON.parse(fs.readFileSync('/home/user/Sonnar/dataset_mestre.json', 'utf8'));

const driver = `
console.log('Script carregado. Total de giros no dataset:', ${dataset.length});
const __dataset = ${JSON.stringify(dataset)};

function __processarGiro(n){
  if (historicoTotal.length > 0) verificarCallAnterior(n);
  detectarQuebras(n);
  historicoTotal.unshift(n);
  totalGirosProcessados++;
  registrarNoArquivoPermanente(n);
  if (historicoTotal.length > MAX_HISTORICO) historicoTotal = historicoTotal.slice(0, MAX_HISTORICO);
  executarConciliador();
}

const N_FOLDS = 15;
const WARMUP = 1000;
const foldSize = Math.floor((__dataset.length - WARMUP) / N_FOLDS);
console.log('Warmup:', WARMUP, '| Folds:', N_FOLDS, '| Tamanho por fold:', foldSize);

let __idx = 0;
let __erros = 0;
try {
  for (; __idx < WARMUP; __idx++) __processarGiro(__dataset[__idx]);
} catch(e) { console.error('ERRO no warmup, giro', __idx, ':', e.message); __erros++; }

const __estruturalFolds = [];
for (let f = 1; f <= N_FOLDS && __erros === 0; f++) {
  const antes = { total: estruturalPredictions.total, acertos: estruturalPredictions.acertos };
  const t0 = Date.now();
  const rt = retreinarModeloEstrutural();
  const dtTreino = (Date.now() - t0) / 1000;
  const fimFold = Math.min(__dataset.length, __idx + foldSize);
  const giroInicioFold = __idx;
  try {
    for (; __idx < fimFold; __idx++) __processarGiro(__dataset[__idx]);
  } catch(e) { console.error('ERRO no fold', f, ', giro', __idx, ':', e.message); __erros++; break; }
  const depois = { total: estruturalPredictions.total, acertos: estruturalPredictions.acertos };
  const deltaTotal = depois.total - antes.total;
  const deltaAcertos = depois.acertos - antes.acertos;
  const acc = deltaTotal > 0 ? deltaAcertos / deltaTotal : null;
  __estruturalFolds.push({
    fold: f, arquivoPermanente: historicoArquivoPermanente.length,
    retreinoSucesso: rt.sucesso, valAccRetreino: rt.valAcc, exemplosRetreino: rt.exemplos,
    tempoTreinoSeg: +dtTreino.toFixed(1),
    girosNoFold: fimFold - giroInicioFold, chamadasNoFold: deltaTotal, acertosNoFold: deltaAcertos,
    acc
  });
  console.log('Fold ' + f + ': arquivo=' + historicoArquivoPermanente.length + ' giros | treino=' + dtTreino.toFixed(1) + 's (valAcc treino=' + (rt.valAcc*100).toFixed(1) + '%) | Estrutural AO VIVO nesse fold: ' + (acc!==null ? (acc*100).toFixed(1)+'% ('+deltaAcertos+'/'+deltaTotal+')' : 'sem chamadas'));
}

console.log('\\n=== RESUMO ESTRUTURAL (' + __estruturalFolds.length + ' folds de retreino ao vivo) ===');
const __accsValidos = __estruturalFolds.filter(r => r.acc !== null).map(r => r.acc);
if (__accsValidos.length > 0) {
  const __media = __accsValidos.reduce((s,a)=>s+a,0) / __accsValidos.length;
  const __std = Math.sqrt(__accsValidos.reduce((s,a)=>s+(a-__media)**2,0) / __accsValidos.length);
  console.log('Media top-3 ao vivo entre folds:', (__media*100).toFixed(1) + '%');
  console.log('Desvio padrao entre folds:', (__std*100).toFixed(1) + 'pp');
  console.log('Min / Max:', (Math.min(...__accsValidos)*100).toFixed(1) + '% / ' + (Math.max(...__accsValidos)*100).toFixed(1) + '%');
  console.log('Baseline teorico: ~30% | Ja documentado no briefing: 68-69%');
}

// --- ML 3/5/7 (modelo FIXO, pesos pre-treinados offline - so reavalia estabilidade, sem retreino) ---
console.log('\\n=== RESUMO ML 3/5/7 (modelo fixo, avaliado em 20 janelas cronologicas) ===');
const N_JANELAS_ML = 20;
const winSize = Math.floor(mlTerminalCallLog.length / N_JANELAS_ML);
const __mlJanelas = [];
for (let w = 0; w < N_JANELAS_ML; w++) {
  const slice = mlTerminalCallLog.slice(w*winSize, w===N_JANELAS_ML-1 ? mlTerminalCallLog.length : (w+1)*winSize);
  if (slice.length === 0) continue;
  const hits = slice.filter(c => c.acerto).length;
  __mlJanelas.push({ janela: w+1, n: slice.length, acc: hits/slice.length });
}
__mlJanelas.forEach(j => console.log('Janela ' + j.janela + ': n=' + j.n + ' | ' + (j.acc*100).toFixed(1) + '%'));
const __mlAccs = __mlJanelas.map(j => j.acc);
const __mlMedia = __mlAccs.reduce((s,a)=>s+a,0)/__mlAccs.length;
const __mlStd = Math.sqrt(__mlAccs.reduce((s,a)=>s+(a-__mlMedia)**2,0)/__mlAccs.length);
console.log('Total de chamadas ML 3/5/7 no dataset inteiro:', mlTerminalCallLog.length);
console.log('Media top-3 entre as 20 janelas:', (__mlMedia*100).toFixed(1) + '%');
console.log('Desvio padrao entre janelas:', (__mlStd*100).toFixed(1) + 'pp');
console.log('Min / Max:', (Math.min(...__mlAccs)*100).toFixed(1) + '% / ' + (Math.max(...__mlAccs)*100).toFixed(1) + '%');
console.log('Baseline: ~30% | Ja documentado no briefing: 32.8% (p<0.0001)');

fs.writeFileSync('/home/user/Sonnar/experiments/resultado_validacao_cruzada_extensa.json', JSON.stringify({
  estrutural: __estruturalFolds, mlJanelas: __mlJanelas
}, null, 2));
console.log('\\nResultado salvo em experiments/resultado_validacao_cruzada_extensa.json');

globalThis.__ERROS_FINAIS = __erros;
`;

const combined = mingScript + '\n\n' + driver;
try {
  vm.runInThisContext(combined, { filename: 'validacao_cruzada.js' });
} catch (e) {
  console.error('ERRO FATAL:', e);
  process.exit(1);
}
process.exit(global.__ERROS_FINAIS === 0 ? 0 : 1);
