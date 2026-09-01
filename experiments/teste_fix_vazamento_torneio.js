// Testa a correcao do vazamento APLICADA em ming_t123.html (nao mais via monkey-patch).
// Reproduz a mesma metodologia dos experimentos anteriores (15 folds, retreino ao vivo do
// Estrutural, ~11.3k giros reais) e confere se os numeros batem com a coluna "CORRIGIDO"
// ja validada (Torneio combinado 56.7%, EWMA/CUSUM 61.5%, ML 3/5/7 52.0%, Estrutural 53.9%).
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

const __porCandidato = {};
const __origAtualizarEVerificarTorneio = atualizarEVerificarTorneio;
atualizarEVerificarTorneio = function(novoNumero){
  const resultado = __origAtualizarEVerificarTorneio(novoNumero);
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
let __erros = 0;
try {
  for (; __idx < WARMUP; __idx++) __processarGiro(__dataset[__idx]);
  for (let f = 1; f <= N_FOLDS; f++) {
    retreinarModeloEstrutural();
    const fimFold = Math.min(__dataset.length, __idx + foldSize);
    for (; __idx < fimFold; __idx++) __processarGiro(__dataset[__idx]);
  }
} catch(e) {
  __erros++;
  console.error('ERRO no giro ' + __idx + ':', e.message);
  console.error(e.stack.split('\\n').slice(0,5).join('\\n'));
}

console.log('Giros processados:', totalGirosProcessados, '| Erros:', __erros);
console.log('\\n=== Assertividade por candidato quando VENCE (com o fix aplicado) ===');
let totalGeral=0, acertosGeral=0;
for (const cand of Object.keys(__porCandidato)) {
  const c = __porCandidato[cand];
  totalGeral += c.total; acertosGeral += c.acertos;
  console.log(cand + ': venceu ' + c.total + 'x | acerto quando venceu = ' + (c.acertos/c.total*100).toFixed(1) + '% (' + c.acertos + '/' + c.total + ')');
}
console.log('TOTAL combinado: ' + (acertosGeral/totalGeral*100).toFixed(1) + '% (' + acertosGeral + '/' + totalGeral + ')');

console.log('\\n--- Comparacao com a coluna CORRIGIDO ja validada anteriormente ---');
console.log('Esperado: ML 3/5/7=52.0% (1701/3269) | EWMA/CUSUM=61.5% (2426/3947) | Estrutural=53.9% (732/1358) | TOTAL=56.7% (4859/8574)');

globalThis.__OK = (__erros === 0);
`;

const combined = mingScript + '\n\n' + driver;
try {
  vm.runInThisContext(combined, { filename: 'teste_fix_vazamento.js' });
} catch (e) {
  console.error('ERRO FATAL:', e);
  process.exit(1);
}
process.exit(global.__OK ? 0 : 1);
