// Pergunta do Ricardo: quando o Estrutural é especificamente o VENCEDOR do torneio
// (não só aprovado no portão, mas o candidato escolhido pra call oficial), qual a
// assertividade real dele NESSES giros? Diferente do top-3 isolado (que mede em TODO
// giro, vencendo ou não) - aqui filtra só os giros em que ele liderou de fato.
//
// Mesma metodologia da validacao_cruzada_extensa.js (retreino ao vivo em 15 checkpoints
// cronológicos, walk-forward, sem pool de tudo como amostra única) - só que agora
// monkey-patcha atualizarEVerificarTorneio pra contar, POR CANDIDATO VENCEDOR, quantas
// vezes ele venceu e quantas dessas foram acerto (torneioCallLog é truncado em 300
// entradas, não dá pra usar o log direto pra cobrir 11k giros).
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
console.log('Total de giros no dataset:', ${dataset.length});
const __dataset = ${JSON.stringify(dataset)};

// --- monkey-patch: envolve atualizarEVerificarTorneio pra contar por candidato vencedor,
// sem alterar nenhum comportamento (so observa o resultado que a funcao original ja devolve) ---
const __origAtualizarEVerificarTorneio = atualizarEVerificarTorneio;
const __porCandidato = {}; // { 'Estrutural': {total, acertos}, 'EWMA/CUSUM': ..., 'ML 3/5/7': ... }
atualizarEVerificarTorneio = function(novoNumero, sTrend){
  const resultado = __origAtualizarEVerificarTorneio(novoNumero, sTrend);
  if (resultado && resultado.vencedor) {
    if (!__porCandidato[resultado.vencedor]) __porCandidato[resultado.vencedor] = {total:0, acertos:0};
    const tReal = terminalDig(novoNumero);
    const hit = resultado.pacote.includes(tReal);
    __porCandidato[resultado.vencedor].total++;
    if (hit) __porCandidato[resultado.vencedor].acertos++;
  }
  return resultado;
};

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

let __idx = 0;
for (; __idx < WARMUP; __idx++) __processarGiro(__dataset[__idx]);

const __foldsPorCandidato = [];
for (let f = 1; f <= N_FOLDS; f++) {
  retreinarModeloEstrutural();
  const antes = JSON.parse(JSON.stringify(__porCandidato));
  const fimFold = Math.min(__dataset.length, __idx + foldSize);
  for (; __idx < fimFold; __idx++) __processarGiro(__dataset[__idx]);
  const depois = __porCandidato;
  const linha = { fold: f };
  for (const cand of Object.keys(depois)) {
    const a = antes[cand] || {total:0, acertos:0};
    const d = depois[cand];
    const deltaTotal = d.total - a.total;
    const deltaAcertos = d.acertos - a.acertos;
    linha[cand] = { n: deltaTotal, acertos: deltaAcertos, acc: deltaTotal > 0 ? deltaAcertos/deltaTotal : null };
  }
  __foldsPorCandidato.push(linha);
  const estr = linha['Estrutural'];
  console.log('Fold ' + f + ' | Estrutural venceu ' + (estr ? estr.n : 0) + 'x nesse fold, acerto=' + (estr && estr.acc!==null ? (estr.acc*100).toFixed(1)+'%' : 'sem vitorias'));
}

console.log('\\n=== RESUMO GERAL (dataset inteiro, ' + totalGirosProcessados + ' giros) ===');
for (const cand of Object.keys(__porCandidato)) {
  const c = __porCandidato[cand];
  console.log(cand + ': venceu ' + c.total + 'x | acerto quando venceu = ' + (c.acertos/c.total*100).toFixed(1) + '% (' + c.acertos + '/' + c.total + ')');
}

console.log('\\n=== Estrutural especificamente, fold a fold (quando foi o VENCEDOR) ===');
__foldsPorCandidato.forEach(l => {
  const e = l['Estrutural'];
  console.log('Fold ' + l.fold + ': n=' + (e?e.n:0) + ' | acerto=' + (e && e.acc!==null ? (e.acc*100).toFixed(1)+'%' : 'sem vitorias nesse fold'));
});
const __accsEstr = __foldsPorCandidato.map(l => l['Estrutural']).filter(e => e && e.acc !== null).map(e => e.acc);
if (__accsEstr.length > 0) {
  const __media = __accsEstr.reduce((s,a)=>s+a,0)/__accsEstr.length;
  const __std = Math.sqrt(__accsEstr.reduce((s,a)=>s+(a-__media)**2,0)/__accsEstr.length);
  console.log('\\nMedia entre folds (so quando Estrutural venceu):', (__media*100).toFixed(1)+'%');
  console.log('Desvio padrao entre folds:', (__std*100).toFixed(1)+'pp');
}

fs.writeFileSync('/home/user/Sonnar/experiments/resultado_assertividade_vencedor.json', JSON.stringify({
  geral: __porCandidato, porFold: __foldsPorCandidato
}, null, 2));
console.log('\\nResultado salvo em experiments/resultado_assertividade_vencedor.json');
globalThis.__OK = true;
`;

const combined = mingScript + '\n\n' + driver;
try {
  vm.runInThisContext(combined, { filename: 'assertividade_vencedor.js' });
} catch (e) {
  console.error('ERRO FATAL:', e);
  process.exit(1);
}
process.exit(global.__OK ? 0 : 1);
