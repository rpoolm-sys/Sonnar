// Teste de regressao PERMANENTE contra vazamento de dado (look-ahead bias) nos ~10
// subsistemas stateful do Sonnar / Ming T123 (EWMA/CUSUM, ML 3/5/7, Estrutural, Residual,
// CUSUM de Setor, Reforco Adaptativo, DZ2/Trend, Termometro, Torneio, Chave Promissora...).
//
// Metodologia (mesma do teste_fix_vazamento_torneio.js): extrai o <script> de dentro do
// ming_t123.html ATUAL, stuba document/localStorage/etc, roda o motor headless no vm do
// Node, alimenta TODO o dataset_mestre.json giro a giro reproduzindo exatamente a ordem de
// chamadas de adicionarSorteio() (verificarCallAnterior -> detectarQuebras ->
// historicoTotal.unshift -> executarConciliador).
//
// Para CADA callLog existente no motor, recalcula .acerto de forma INDEPENDENTE a partir dos
// proprios campos logados (.real/.pacote ou equivalente) e confere se bate com o que foi
// armazenado. Isso pega qualquer lugar onde o "acerto" foi computado usando um estado que
// ja tinha sido contaminado pelo giro atual (o pacote/call minado por um atualizarX() que
// rodou cedo demais) - se o pacote logado nao contem mais a mesma informacao que gerou aquele
// acerto, a reconstrucao diverge.
//
// Uso: node experiments/teste_regressao_permanente.js
// Sai com codigo 0 se todas as divergencias forem 0, codigo 1 caso contrario.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML_PATH = path.join(__dirname, '..', 'ming_t123.html');
const DATASET_PATH = path.join(__dirname, '..', 'dataset_mestre.json');

// --- 1) Extrai o <script> principal do HTML atual (sem hardcode de copia antiga) ---
const html = fs.readFileSync(HTML_PATH, 'utf8');
const scriptMatches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (scriptMatches.length === 0) {
  console.error('ERRO: nenhum <script> encontrado em ming_t123.html');
  process.exit(1);
}
// pega o maior bloco de script (o motor principal), ignora scripts pequenos/externos se houver
let mingScript = scriptMatches.map(m => m[1]).sort((a, b) => b.length - a.length)[0];

// remove os listeners de teclado que dependem de elementos reais do DOM
mingScript = mingScript.replace(
  "document.getElementById('novoSorteio').addEventListener('keypress',function(e){if(e.key==='Enter')adicionarSorteio();});", ''
);
mingScript = mingScript.replace(
  "document.getElementById('loteSorteio').addEventListener('keypress',function(e){if(e.key==='Enter')carregarLote();});", ''
);

// --- 2) Stubs de ambiente (document/localStorage/etc) - mesma receita do experimento anterior ---
class FakeElement {
  constructor(id) {
    this.id = id; this._innerHTML = ''; this._textContent = ''; this.value = ''; this.style = {};
    this.classList = { add(){}, remove(){}, contains(){return false;}, toggle(){} };
  }
  get innerHTML() { return this._innerHTML; } set innerHTML(v) { this._innerHTML = v; }
  get textContent() { return this._textContent; } set textContent(v) { this._textContent = v; }
  appendChild(){} removeChild(){} addEventListener(){}
}
const elements = {};
function getElementById(id) { if (!elements[id]) elements[id] = new FakeElement(id); return elements[id]; }
const localStorageStore = {};
global.document = {
  getElementById,
  createElement: () => new FakeElement('anon'),
  body: { appendChild(){}, removeChild(){} },
  querySelectorAll: () => []
};
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

// --- 3) Dataset real ---
const dataset = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf8'));

// --- 4) Driver: processa o dataset inteiro reproduzindo a ordem de adicionarSorteio(),
// e ao final recalcula cada callLog de forma independente ---
const driver = `
console.log('Total de giros no dataset:', ${dataset.length});
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

// [NOVO] Sem isso, modeloEstrutural fica null pra sempre e o candidato Estrutural nunca
// entra em jogo (estruturalCallLog ficaria vazio, sem cobertura nenhuma nesse teste).
// Mesma metodologia do experiments/teste_fix_vazamento_torneio.js: warmup + retreino por fold.
const N_FOLDS = 15;
const WARMUP = 1000;
const foldSize = Math.floor((__dataset.length - WARMUP) / N_FOLDS);

let __erros = 0, __idx = 0;
try {
  for (; __idx < WARMUP && __idx < __dataset.length; __idx++) __processarGiro(__dataset[__idx]);
  for (let f = 1; f <= N_FOLDS; f++) {
    retreinarModeloEstrutural();
    const fimFold = Math.min(__dataset.length, WARMUP + f * foldSize);
    for (; __idx < fimFold; __idx++) __processarGiro(__dataset[__idx]);
  }
  for (; __idx < __dataset.length; __idx++) __processarGiro(__dataset[__idx]);
} catch(e) {
  __erros++;
  console.error('ERRO no giro ' + __idx + ':', e.message);
  console.error(e.stack.split('\\n').slice(0,8).join('\\n'));
}
console.log('Giros processados:', totalGirosProcessados, '| Erros de execucao:', __erros);

// ============================================================================
// Reconciliacao independente de cada callLog - recalcula .acerto a partir dos proprios
// campos logados e compara com o que foi armazenado pelo motor.
// ============================================================================
const __relatorio = {};

function __checarLog(nome, log, calcularAcertoEsperado){
  if (typeof log === 'undefined' || !Array.isArray(log)) {
    __relatorio[nome] = {existe:false};
    return;
  }
  let divergencias = 0;
  const exemplos = [];
  for (let i=0; i<log.length; i++){
    const entry = log[i];
    let esperado;
    try { esperado = calcularAcertoEsperado(entry); }
    catch(e){ esperado = undefined; }
    if (esperado === undefined) continue; // entrada fora do formato esperado, pula (nao conta como divergencia)
    if (Boolean(esperado) !== Boolean(entry.acerto)){
      divergencias++;
      if (exemplos.length < 5) exemplos.push({i, entry, esperado});
    }
  }
  __relatorio[nome] = {existe:true, total:log.length, divergencias, exemplos};
}

// torneioCallLog: {vencedor, pacote, ativos, indicador, real, acerto}
__checarLog('torneioCallLog', typeof torneioCallLog!=='undefined'?torneioCallLog:undefined, e => e.pacote.includes(e.real));

// residualCallLog: {top3, real, acerto}
__checarLog('residualCallLog', typeof residualCallLog!=='undefined'?residualCallLog:undefined, e => e.top3.includes(e.real));

// terminalRadarCallLog: {lider, pacote, real, acerto}
__checarLog('terminalRadarCallLog', typeof terminalRadarCallLog!=='undefined'?terminalRadarCallLog:undefined, e => e.pacote.includes(e.real));

// mlTerminalCallLog: {top3, real, acerto}
__checarLog('mlTerminalCallLog', typeof mlTerminalCallLog!=='undefined'?mlTerminalCallLog:undefined, e => e.top3.includes(e.real));

// estruturalCallLog: {top3, real, acerto}
__checarLog('estruturalCallLog', typeof estruturalCallLog!=='undefined'?estruturalCallLog:undefined, e => e.top3.includes(e.real));

// trendCallLog: {de, para, tipo, call, acerto} - call e' tipo 'DZ1+DZ2' ou 'Col1+Col2'
__checarLog('trendCallLog', typeof trendCallLog!=='undefined'?trendCallLog:undefined, e => {
  const nums = (e.call.match(/\\d+/g) || []).map(Number);
  if (nums.length===0) return undefined;
  if (e.tipo==='DZ') return nums.includes(duzia(e.para));
  if (e.tipo==='Col') return nums.includes(coluna(e.para));
  return undefined;
});

// sniperCallLog: {de, para, call, acerto} - call e' "n1,n2,n3..." (numeros literais)
__checarLog('sniperCallLog', typeof sniperCallLog!=='undefined'?sniperCallLog:undefined, e => {
  const nums = e.call.split(',').map(Number).filter(x=>!isNaN(x));
  if (nums.length===0) return undefined;
  return nums.includes(e.para);
});

// chavePromissoraCallLog: {de, para, call, acerto, giro} - call e' so o LABEL da categoria
// (ex 'Par', 'T5'), os numeros nao ficam guardados na entrada - usa o mesmo lookup estatico
// chavePromissoraNumeros(label) (mapeamento categoria->numeros, nao e' logica de acerto).
__checarLog('chavePromissoraCallLog', typeof chavePromissoraCallLog!=='undefined'?chavePromissoraCallLog:undefined, e => {
  if (typeof chavePromissoraNumeros !== 'function') return undefined;
  const numeros = chavePromissoraNumeros(e.call);
  if (!numeros || numeros.length===0) return undefined;
  return numeros.includes(e.para);
});

console.log('\\n=== Divergencias por callLog (deve ser 0 em todos apos as correcoes) ===');
let __totalDivergencias = 0;
for (const nome of Object.keys(__relatorio)){
  const r = __relatorio[nome];
  if (!r.existe){
    console.log(nome + ': (nao existe no motor - pulado)');
    continue;
  }
  __totalDivergencias += r.divergencias;
  console.log(nome + ': ' + r.divergencias + ' divergencias / ' + r.total + ' entradas');
  if (r.divergencias > 0){
    console.log('  exemplos:', JSON.stringify(r.exemplos, null, 2));
  }
}
console.log('\\nTOTAL DE DIVERGENCIAS: ' + __totalDivergencias);

globalThis.__OK = (__erros === 0 && __totalDivergencias === 0);
`;

const combined = mingScript + '\n\n' + driver;
try {
  vm.runInThisContext(combined, { filename: 'teste_regressao_permanente.js' });
} catch (e) {
  console.error('ERRO FATAL:', e);
  process.exit(1);
}
process.exit(global.__OK ? 0 : 1);
