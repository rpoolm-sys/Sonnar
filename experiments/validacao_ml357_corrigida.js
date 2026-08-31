// [CORRIGIDO] validacao_cruzada_extensa.js media a estabilidade do ML 3/5/7 lendo
// mlTerminalCallLog, que e truncado em 200 entradas (so as mais recentes) - as "20 janelas"
// acabaram cobrindo so os ultimos ~200 giros (n=10 cada), nao o dataset inteiro. Esse script
// usa mlTerminalPredictions.total/acertos (contador cumulativo, NUNCA truncado) com snapshots
// em 20 checkpoints cronologicos igualmente espacados ao longo dos 11.3k giros - sem retreino
// (o ML 3/5/7 usa pesos fixos MODELO_TERMINAL_PESOS, so precisa reavaliar).
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
const __dataset = ${JSON.stringify(dataset)};
function __processarGiro(n){
  if (historicoTotal.length > 0) verificarCallAnterior(n);
  detectarQuebras(n);
  historicoTotal.unshift(n);
  totalGirosProcessados++;
  if (historicoTotal.length > MAX_HISTORICO) historicoTotal = historicoTotal.slice(0, MAX_HISTORICO);
  executarConciliador();
}

const N_JANELAS = 20;
const janelaSize = Math.floor(__dataset.length / N_JANELAS);
const __janelas = [];
let __idxPrev = 0;
let __prevTotal = 0, __prevAcertos = 0;
for (let w = 1; w <= N_JANELAS; w++) {
  const fim = (w === N_JANELAS) ? __dataset.length : w * janelaSize;
  for (; __idxPrev < fim; __idxPrev++) __processarGiro(__dataset[__idxPrev]);
  const deltaTotal = mlTerminalPredictions.total - __prevTotal;
  const deltaAcertos = mlTerminalPredictions.acertos - __prevAcertos;
  __prevTotal = mlTerminalPredictions.total; __prevAcertos = mlTerminalPredictions.acertos;
  const acc = deltaTotal > 0 ? deltaAcertos / deltaTotal : null;
  __janelas.push({ janela: w, giros: fim - (fim - janelaSize < 0 ? 0 : (w===1?0:(w-1)*janelaSize)), n: deltaTotal, acertos: deltaAcertos, acc });
  console.log('Janela ' + w + ' (giros ate ' + fim + '): n=' + deltaTotal + ' | ' + (acc!==null ? (acc*100).toFixed(1)+'%' : 'sem dados'));
}

console.log('\\nTotal de chamadas ML 3/5/7 no dataset inteiro:', mlTerminalPredictions.total);
const __accs = __janelas.filter(j=>j.acc!==null).map(j=>j.acc);
const __media = __accs.reduce((s,a)=>s+a,0)/__accs.length;
const __std = Math.sqrt(__accs.reduce((s,a)=>s+(a-__media)**2,0)/__accs.length);
console.log('Media top-3 entre as ' + __accs.length + ' janelas (cumulativo, sem truncamento):', (__media*100).toFixed(1) + '%');
console.log('Desvio padrao entre janelas:', (__std*100).toFixed(1) + 'pp');
console.log('Min / Max:', (Math.min(...__accs)*100).toFixed(1) + '% / ' + (Math.max(...__accs)*100).toFixed(1) + '%');
console.log('Acuracia GLOBAL (todo o dataset, um numero so):', (mlTerminalPredictions.acertos/mlTerminalPredictions.total*100).toFixed(1) + '% (' + mlTerminalPredictions.acertos + '/' + mlTerminalPredictions.total + ')');
console.log('Baseline: ~30% | Ja documentado no briefing: 32.8% (p<0.0001, n=11k)');

fs.writeFileSync('/home/user/Sonnar/experiments/resultado_ml357_janelas_corrigido.json', JSON.stringify(__janelas, null, 2));
globalThis.__OK = true;
`;

const combined = mingScript + '\n\n' + driver;
try {
  vm.runInThisContext(combined, { filename: 'validacao_ml357.js' });
} catch (e) {
  console.error('ERRO FATAL:', e);
  process.exit(1);
}
process.exit(global.__OK ? 0 : 1);
