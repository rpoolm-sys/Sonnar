// Investiga os 2 achados em aberto do modelo Estrutural (pedido do Ricardo):
// A) Fold 7 colapsou pra 34% de valAcc no retreino - seed ruim ou dado ruim?
// B) Top-3 isolado fraco (~28.5%, perto do baseline) apesar do valAcc ~69% - por que?
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

console.log('########## DIAGNOSTICO A: fold 7 (arquivo=5146 giros) - seed ruim ou dado ruim? ##########');
historicoArquivoPermanente = __dataset.slice(0, 5146).map(n => ({n, t: Date.now()}));
const __rodadas = [];
for (let i = 1; i <= 20; i++) {
  const rt = retreinarModeloEstrutural();
  __rodadas.push(rt.sucesso ? rt.valAcc : null);
  console.log('Rodada ' + i + ': ' + (rt.sucesso ? (rt.valAcc*100).toFixed(1)+'%' : 'FALHOU: '+rt.motivo) + ' (exemplos=' + (rt.exemplos||0) + ')');
}
const __validas = __rodadas.filter(x => x !== null);
const __media = __validas.reduce((s,a)=>s+a,0)/__validas.length;
const __std = Math.sqrt(__validas.reduce((s,a)=>s+(a-__media)**2,0)/__validas.length);
console.log('\\nMedia de 20 rodadas (mesmo dado, seeds diferentes):', (__media*100).toFixed(1)+'%');
console.log('Desvio padrao entre rodadas:', (__std*100).toFixed(1)+'pp');
console.log('Min / Max:', (Math.min(...__validas)*100).toFixed(1)+'% / '+(Math.max(...__validas)*100).toFixed(1)+'%');
console.log('Rodadas abaixo de 50%:', __validas.filter(a=>a<0.5).length, '/', __validas.length);

console.log('\\n\\n########## DIAGNOSTICO B: por que o top-3 isolado fica perto do baseline? ##########');
// treina com o dataset inteiro (mais representativo do uso real) e examina a distribuicao
// de probabilidades entre os 10 terminais em varios pontos do historico
historicoArquivoPermanente = __dataset.map(n => ({n, t: Date.now()}));
const rtFull = retreinarModeloEstrutural();
console.log('Modelo treinado com dataset inteiro: valAcc=' + (rtFull.valAcc*100).toFixed(1) + '% (' + rtFull.exemplos + ' exemplos)');

// reconstroi o historico e sTrend em alguns pontos do dataset pra inspecionar as 10 probabilidades
resetarTudo();
const __amostrasDiag = [];
for (let i = 0; i < __dataset.length; i++) {
  const novo = __dataset[i];
  if (historicoTotal.length > 0) verificarCallAnterior(novo);
  detectarQuebras(novo);
  historicoTotal.unshift(novo);
  totalGirosProcessados++;
  if (historicoTotal.length > MAX_HISTORICO) historicoTotal = historicoTotal.slice(0, MAX_HISTORICO);
  const sTrend = analisarTrend();
  executarConciliador();
  // amostra 1 a cada 500 giros (depois de aquecido) pra nao gerar log gigante
  if (i > 200 && i % 500 === 0) {
    const probs = [0,1,2,3,4,5,6,7,8,9].map(t => preverModeloEstrutural(t, historicoTotal, sTrend));
    const ordenado = probs.map((p,t)=>({t,p})).sort((a,b)=>b.p-a.p);
    const top3 = ordenado.slice(0,3);
    const gap3_4 = ordenado[2].p - ordenado[3].p; // diferenca entre o 3o e o 4o colocado (quao "decisivo" e o corte)
    __amostrasDiag.push({
      giro: i,
      probs: probs.map(p=>+p.toFixed(3)),
      top3: top3.map(x=>x.t+':'+x.p.toFixed(2)).join(', '),
      gap3_4: +gap3_4.toFixed(3),
      nFavoraveis: probs.filter(p=>p>0.5).length
    });
  }
}
console.log('\\nAmostras de distribuicao de probabilidade (1 a cada 500 giros, ' + __amostrasDiag.length + ' pontos):');
__amostrasDiag.slice(0, 15).forEach(a => {
  console.log('Giro ' + a.giro + ': top3=[' + a.top3 + '] | gap(3o-4o)=' + a.gap3_4 + ' | favoraveis(>0.5)=' + a.nFavoraveis);
});
const __gaps = __amostrasDiag.map(a => a.gap3_4);
const __mediaGap = __gaps.reduce((s,a)=>s+a,0)/__gaps.length;
const __favMedio = __amostrasDiag.reduce((s,a)=>s+a.nFavoraveis,0)/__amostrasDiag.length;
console.log('\\nGap medio entre o 3o e o 4o colocado (quao decisivo e o corte do top-3):', __mediaGap.toFixed(3));
console.log('Numero medio de terminais "favoraveis" (prob>0.5) por giro:', __favMedio.toFixed(1), 'de 10');
console.log('(se o gap for pequeno e/ou muitos terminais empatados como favoraveis, o top-3 vira um corte quase arbitrario dentro do grupo empatado)');

fs.writeFileSync('/home/user/Sonnar/experiments/resultado_diagnostico_estrutural.json', JSON.stringify({
  fold7Rodadas: __rodadas, amostrasDiag: __amostrasDiag
}, null, 2));
console.log('\\nResultado salvo em experiments/resultado_diagnostico_estrutural.json');
globalThis.__OK = true;
`;

const combined = mingScript + '\n\n' + driver;
try {
  vm.runInThisContext(combined, { filename: 'diagnostico_estrutural.js' });
} catch (e) {
  console.error('ERRO FATAL:', e);
  process.exit(1);
}
process.exit(global.__OK ? 0 : 1);
