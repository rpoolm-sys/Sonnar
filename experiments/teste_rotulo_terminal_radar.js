// Testa a correcao de rotulo/estilo em renderTerminalRadar(): confirma que so o bloco
// "CALL DO TORNEIO" contem a palavra "Call" sem qualificacao, e que os numeros
// (torneioPredictions/mlTerminalPredictions/estruturalPredictions) nao mudaram - essa
// e uma correcao PURAMENTE visual, nao deve alterar nenhuma logica de decisao.
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
const amostra = dataset.slice(-3000);

const driver = `
const __amostra = ${JSON.stringify(amostra)};
let __erros = 0;
for (let i = 0; i < __amostra.length; i++) {
  try {
    const n = __amostra[i];
    if (historicoTotal.length > 0) verificarCallAnterior(n);
    detectarQuebras(n);
    historicoTotal.unshift(n);
    totalGirosProcessados++;
    registrarNoArquivoPermanente(n);
    if (historicoTotal.length > MAX_HISTORICO) historicoTotal = historicoTotal.slice(0, MAX_HISTORICO);
    executarConciliador();
  } catch (e) {
    __erros++;
    console.error('ERRO no giro ' + i + ':', e.message);
    if (__erros > 5) break;
  }
}
console.log('Giros processados:', totalGirosProcessados, '| Erros:', __erros);

// forca o retreino do Estrutural pra garantir que o painel dele apareca no HTML gerado
retreinarModeloEstrutural();
renderTerminalRadar(analisarTrend());
const html = document.getElementById('terminalRadarContent').innerHTML;

// conta quantos blocos tem a palavra "Call" (maiusculo, como rotulo) SEM qualificacao
// (ignora "CALL DO TORNEIO", que e a unica call de verdade)
const matches = [...html.matchAll(/Call[^<]*/gi)].map(m => m[0]);
console.log('\\nTodas as ocorrencias da palavra "Call" no HTML gerado:');
matches.forEach(m => console.log('  -> ' + m));

const semQualificacao = matches.filter(m => !m.includes('TORNEIO') && !m.includes('não é a call') && !m.includes('nao e a call'));
console.log('\\nBlocos com "Call" SEM qualificar que nao e a oficial (deve ser 0):', semQualificacao.length);
semQualificacao.forEach(m => console.log('  PROBLEMA -> ' + m));

console.log('\\n--- Numeros (devem bater com o comportamento de sempre, sem mudanca) ---');
console.log('torneioPredictions:', JSON.stringify(torneioPredictions));
console.log('mlTerminalPredictions:', JSON.stringify(mlTerminalPredictions));
console.log('estruturalPredictions:', JSON.stringify(estruturalPredictions));

console.log('\\n--- Trecho do HTML gerado (candidato ML e Estrutural) ---');
const idxML = html.indexOf('Candidato ML');
const idxEstr = html.indexOf('Candidato Estrutural');
console.log(html.slice(idxML, idxML+250));
console.log('---');
console.log(html.slice(idxEstr, idxEstr+250));

globalThis.__OK = (__erros === 0 && semQualificacao.length === 0);
`;

const combined = mingScript + '\n\n' + driver;
try {
  vm.runInThisContext(combined, { filename: 'teste_rotulo.js' });
} catch (e) {
  console.error('ERRO FATAL:', e);
  process.exit(1);
}
process.exit(global.__OK ? 0 : 1);
