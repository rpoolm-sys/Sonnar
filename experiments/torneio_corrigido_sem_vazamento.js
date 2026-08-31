// ACHADO CRÍTICO durante a investigação da pergunta do Ricardo (assertividade do Estrutural
// quando é vencedor): rodarTorneioTerminal() RECALCULA os pacotes dos 3 candidatos direto do
// estado global (ewmaTerminais, historicoTotal), mas esse estado já foi ATUALIZADO com o giro
// que está sendo avaliado - porque atualizarTerminalRadar(historicoTotal[0]) roda ANTES de
// atualizarEVerificarTorneio(historicoTotal[0], sTrend) dentro de executarConciliador().
//
// Isso é um vazamento de dado: o candidato EWMA/CUSUM, por exemplo, teve 99.8% de acerto
// quando venceu o torneio nesta sessão - estatisticamente impossível pra uma previsão real,
// e bate com o mecanismo: o terminal que ACABOU de sair já entrou no EWMA antes do pacote
// top-4 ser recalculado, então o pacote "prevendo" o próximo giro já inclui, quase sempre,
// o terminal que acabou de sair.
//
// A boa notícia: cada candidato JÁ TEM um check individual em outro lugar do código que é
// CORRETAMENTE blindado contra esse vazamento (usa o estado ANTES do giro atual):
//   - EWMA/CUSUM: terminalRadarCallLog (calculado no TOPO de atualizarTerminalRadar, antes
//     do loop que atualiza ewmaTerminais)
//   - ML 3/5/7: mlTerminalCallLog (usa histAntes = historicoTotal.slice(1))
//   - Estrutural: estruturalCallLog (usa histAntesEstrut = historicoTotal.slice(1))
//
// Este script reconstrói o torneio usando essas 3 fontes já blindadas (em vez de recalcular
// do zero como o código original faz), pra descobrir a assertividade REAL de cada candidato
// quando vence - sem o vazamento.
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

// --- versao corrigida: le os pacotes JA CALCULADOS (sem vazamento) de cada candidato pro
// giro atual, em vez de recalcular do zero com estado ja atualizado ---
function rodarTorneioTerminalCorrigido(){
    const ewmaEntry = terminalRadarCallLog.length ? terminalRadarCallLog[terminalRadarCallLog.length-1] : null;
    const mlEntry = mlTerminalCallLog.length ? mlTerminalCallLog[mlTerminalCallLog.length-1] : null;
    const estrEntry = estruturalCallLog.length ? estruturalCallLog[estruturalCallLog.length-1] : null;

    const top4EWMA = ewmaEntry ? ewmaEntry.pacote : [];
    const top3ML = mlEntry ? mlEntry.top3 : [];
    const top3Estrutural = estrEntry ? estrEntry.top3 : [];

    const candidatos = [
        {nome:'EWMA/CUSUM', pacote:top4EWMA, log:terminalRadarCallLog, baseline:0.40},
        {nome:'ML 3/5/7',    pacote:top3ML,   log:mlTerminalCallLog,    baseline:0.30},
        {nome:'Estrutural',  pacote:top3Estrutural, log:estruturalCallLog, baseline:0.30}
    ];

    const aprovados = candidatos.filter(c=>{
        const ewmaAcerto = janelaEEwma(c.log).pctEwma;
        return ewmaAcerto!==null && ewmaAcerto > (c.baseline + TORNEIO_MARGEM_GATE) && c.pacote.length>0;
    });
    if(aprovados.length===0) return {vencedor:null, pacote:[], ativos:[], indicador:null};

    let melhor = aprovados[0];
    let melhorTaxa = taxaJanelaRapida(melhor.log, TORNEIO_JANELA_RAPIDA) || 0;
    for(let i=1;i<aprovados.length;i++){
        const taxa = taxaJanelaRapida(aprovados[i].log, TORNEIO_JANELA_RAPIDA) || 0;
        if(taxa > melhorTaxa){ melhor = aprovados[i]; melhorTaxa = taxa; }
    }
    return {vencedor:melhor.nome, pacote:melhor.pacote, ativos:aprovados.map(c=>c.nome), indicador:null};
}

const __porCandidatoOriginal = {};
const __porCandidatoCorrigido = {};

const __origAtualizarEVerificarTorneio = atualizarEVerificarTorneio;
atualizarEVerificarTorneio = function(novoNumero, sTrend){
  // ORIGINAL (com vazamento) - so pra registrar, nao usamos o retorno pra nada além disso
  const resultadoOriginal = __origAtualizarEVerificarTorneio(novoNumero, sTrend);
  if (resultadoOriginal && resultadoOriginal.vencedor) {
    const c = resultadoOriginal.vencedor;
    if (!__porCandidatoOriginal[c]) __porCandidatoOriginal[c] = {total:0, acertos:0};
    const tReal = terminalDig(novoNumero);
    const hit = resultadoOriginal.pacote.includes(tReal);
    __porCandidatoOriginal[c].total++;
    if (hit) __porCandidatoOriginal[c].acertos++;
  }

  // CORRIGIDO (sem vazamento) - le os pacotes ja calculados nos call logs blindados
  const resultadoCorrigido = rodarTorneioTerminalCorrigido();
  if (resultadoCorrigido && resultadoCorrigido.vencedor) {
    const c = resultadoCorrigido.vencedor;
    if (!__porCandidatoCorrigido[c]) __porCandidatoCorrigido[c] = {total:0, acertos:0};
    const tReal = terminalDig(novoNumero);
    const hit = resultadoCorrigido.pacote.includes(tReal);
    __porCandidatoCorrigido[c].total++;
    if (hit) __porCandidatoCorrigido[c].acertos++;
  }

  return resultadoOriginal; // nao muda o comportamento ao vivo, so observa
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
for (let f = 1; f <= N_FOLDS; f++) {
  retreinarModeloEstrutural();
  const fimFold = Math.min(__dataset.length, __idx + foldSize);
  for (; __idx < fimFold; __idx++) __processarGiro(__dataset[__idx]);
  console.log('Fold ' + f + ' processado (arquivo=' + historicoArquivoPermanente.length + ' giros)');
}

function __relatorio(titulo, obj){
  console.log('\\n=== ' + titulo + ' ===');
  let totalGeral=0, acertosGeral=0;
  for (const cand of Object.keys(obj)) {
    const c = obj[cand];
    totalGeral += c.total; acertosGeral += c.acertos;
    console.log(cand + ': venceu ' + c.total + 'x | acerto quando venceu = ' + (c.acertos/c.total*100).toFixed(1) + '% (' + c.acertos + '/' + c.total + ')');
  }
  console.log('TOTAL combinado (todos os vencedores juntos): ' + (acertosGeral/totalGeral*100).toFixed(1) + '% (' + acertosGeral + '/' + totalGeral + ')');
}

__relatorio('ORIGINAL (com vazamento, igual ao app hoje)', __porCandidatoOriginal);
__relatorio('CORRIGIDO (sem vazamento, usando os call logs ja blindados)', __porCandidatoCorrigido);

fs.writeFileSync('/home/user/Sonnar/experiments/resultado_torneio_corrigido.json', JSON.stringify({
  original: __porCandidatoOriginal, corrigido: __porCandidatoCorrigido
}, null, 2));
console.log('\\nResultado salvo em experiments/resultado_torneio_corrigido.json');
globalThis.__OK = true;
`;

const combined = mingScript + '\n\n' + driver;
try {
  vm.runInThisContext(combined, { filename: 'torneio_corrigido.js' });
} catch (e) {
  console.error('ERRO FATAL:', e);
  process.exit(1);
}
process.exit(global.__OK ? 0 : 1);
