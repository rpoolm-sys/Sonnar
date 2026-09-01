// Resposta à pergunta do Ricardo: as colunas ORIGINAL (com vazamento) e CORRIGIDO (sem
// vazamento) da tabela anterior usam a MESMA população de giros como "vitória de cada
// candidato", ou o vazamento muda quem é classificado como vencedor?
//
// Hipótese a verificar: rodarTorneioTerminal() decide QUEM VENCE (gate + desempate por
// momentum) usando SÓ os campos ".log" de cada candidato (terminalRadarCallLog,
// mlTerminalCallLog, estruturalCallLog) via janelaEEwma()/taxaJanelaRapida() - esses logs
// já são blindados contra o vazamento em AMBAS as versões (original e corrigida), porque
// são preenchidos noutro lugar do código (atualizarTerminalRadar, etc.), não dentro de
// rodarTorneioTerminal. O vazamento só afeta o campo ".pacote" (a lista de terminais
// apostados), que é usado DEPOIS de decidir o vencedor, só pra checar hit/miss.
//
// Se a hipótese estiver certa: o "vencedor" de cada giro é IDÊNTICO nas duas versões -
// só o resultado hit/miss desse mesmo giro pode mudar, porque o pacote apostado é diferente.
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

let __totalGiros = 0;
let __vencedorDiferente = 0;
let __ambosNull = 0;
const __exemplosDivergencia = [];
// pra cada candidato: quantos giros ele venceu (nas 2 versoes), e dentre os giros que
// venceu (mesma populacao), quantos hits mudaram: perdeu (era hit, virou miss),
// ganhou (era miss, virou hit), ou manteve
const __porCandidato = {};

const __origAtualizarEVerificarTorneio = atualizarEVerificarTorneio;
atualizarEVerificarTorneio = function(novoNumero, sTrend){
  const resOrig = __origAtualizarEVerificarTorneio(novoNumero, sTrend);
  const resCorr = rodarTorneioTerminalCorrigido();
  __totalGiros++;

  if ((resOrig.vencedor||null) !== (resCorr.vencedor||null)) {
    __vencedorDiferente++;
    if (__exemplosDivergencia.length < 10) {
      __exemplosDivergencia.push({giro: __totalGiros, vencedorOriginal: resOrig.vencedor, vencedorCorrigido: resCorr.vencedor});
    }
  } else if (resOrig.vencedor === null) {
    __ambosNull++;
  } else {
    // MESMO vencedor nas duas versoes - compara se o hit muda
    const cand = resOrig.vencedor;
    if (!__porCandidato[cand]) __porCandidato[cand] = {n:0, hitOrig:0, hitCorr:0, ganhou:0, perdeu:0, manteveHit:0, manteveMiss:0};
    const tReal = terminalDig(novoNumero);
    const hitOrig = resOrig.pacote.includes(tReal);
    const hitCorr = resCorr.pacote.includes(tReal);
    const c = __porCandidato[cand];
    c.n++;
    if (hitOrig) c.hitOrig++;
    if (hitCorr) c.hitCorr++;
    if (hitOrig && !hitCorr) c.perdeu++;
    else if (!hitOrig && hitCorr) c.ganhou++;
    else if (hitOrig && hitCorr) c.manteveHit++;
    else c.manteveMiss++;
  }
  return resOrig;
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
}

console.log('\\n=== VERIFICACAO: mesma populacao de "vencedor" nas 2 versoes? ===');
console.log('Total de giros com torneio avaliado:', __totalGiros);
console.log('Giros em que o VENCEDOR foi DIFERENTE entre original e corrigido:', __vencedorDiferente, '(' + (__vencedorDiferente/__totalGiros*100).toFixed(2) + '%)');
console.log('Giros em que ambos deram "sem vencedor" (silencio):', __ambosNull);
if (__exemplosDivergencia.length > 0) {
  console.log('Exemplos de divergencia de vencedor:');
  __exemplosDivergencia.forEach(e => console.log('  giro ' + e.giro + ': original=' + e.vencedorOriginal + ' | corrigido=' + e.vencedorCorrigido));
}

console.log('\\n=== DETALHAMENTO POR CANDIDATO (so giros onde os DOIS concordam quem venceu) ===');
for (const cand of Object.keys(__porCandidato)) {
  const c = __porCandidato[cand];
  console.log('\\n' + cand + ' (n=' + c.n + ' giros onde venceu, nas 2 versoes igual):');
  console.log('  Acerto ORIGINAL (com vazamento):  ' + (c.hitOrig/c.n*100).toFixed(1) + '% (' + c.hitOrig + '/' + c.n + ')');
  console.log('  Acerto CORRIGIDO (sem vazamento): ' + (c.hitCorr/c.n*100).toFixed(1) + '% (' + c.hitCorr + '/' + c.n + ')');
  console.log('  Giros que MUDARAM de miss->hit ao corrigir (ganhou):  ' + c.ganhou + ' (' + (c.ganhou/c.n*100).toFixed(1) + '%)');
  console.log('  Giros que MUDARAM de hit->miss ao corrigir (perdeu):  ' + c.perdeu + ' (' + (c.perdeu/c.n*100).toFixed(1) + '%)');
  console.log('  Giros que continuaram HIT nas 2 versoes:              ' + c.manteveHit + ' (' + (c.manteveHit/c.n*100).toFixed(1) + '%)');
  console.log('  Giros que continuaram MISS nas 2 versoes:             ' + c.manteveMiss + ' (' + (c.manteveMiss/c.n*100).toFixed(1) + '%)');
}

fs.writeFileSync('/home/user/Sonnar/experiments/resultado_verificacao_mesma_populacao.json', JSON.stringify({
  totalGiros: __totalGiros, vencedorDiferente: __vencedorDiferente, ambosNull: __ambosNull,
  exemplosDivergencia: __exemplosDivergencia, porCandidato: __porCandidato
}, null, 2));
console.log('\\nResultado salvo em experiments/resultado_verificacao_mesma_populacao.json');
globalThis.__OK = true;
`;

const combined = mingScript + '\n\n' + driver;
try {
  vm.runInThisContext(combined, { filename: 'verificacao_mesma_populacao.js' });
} catch (e) {
  console.error('ERRO FATAL:', e);
  process.exit(1);
}
process.exit(global.__OK ? 0 : 1);
