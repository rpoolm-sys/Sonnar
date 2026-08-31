"""
Gerenciador do dataset mestre - Míng T123 Tracker
Uso:
  python3 gerenciar_dataset.py adicionar <arquivo.json>   -> adiciona novo lote (com dedup automático)
  python3 gerenciar_dataset.py status                     -> mostra quantos giros tem acumulado
"""
import json, sys, os
from datetime import datetime

MESTRE = 'dataset_mestre.json'
LOG = 'dataset_mestre_log.json'

def carregar_mestre():
    if os.path.exists(MESTRE):
        return json.load(open(MESTRE))
    return []

def salvar_mestre(dados):
    json.dump(dados, open(MESTRE,'w'))

def carregar_log():
    if os.path.exists(LOG):
        return json.load(open(LOG))
    return []

def salvar_log(log):
    json.dump(log, open(LOG,'w'), indent=2)

def find_overlap(a, b, minlen=8):
    for L in range(min(len(a), len(b)), minlen-1, -1):
        if a[-L:] == b[:L]:
            return L
    return 0

def encontrar_overlap_em_qualquer_ponto(mestre, novo_lote, minlen=8):
    """Verifica se o novo lote (ou parte dele) ja existe em QUALQUER lugar do mestre,
    nao so no final - evita duplicar dado que ja foi adicionado antes por engano."""
    inicio_novo = novo_lote[:minlen]
    for start in range(len(mestre) - minlen + 1):
        if mestre[start:start+minlen] == inicio_novo:
            return start
    return None

def adicionar_lote(caminho_arquivo, nota=""):
    mestre = carregar_mestre()
    novo = json.load(open(caminho_arquivo))
    if isinstance(novo[0], list):
        # multiplos segmentos no arquivo
        segmentos = novo
    else:
        segmentos = [novo]

    total_adicionado = 0
    for seg in segmentos:
        if len(mestre) == 0:
            mestre = seg[:]
            total_adicionado += len(seg)
            continue

        L = find_overlap(mestre, seg)
        if L > 0:
            mestre += seg[L:]
            total_adicionado += len(seg) - L
            continue

        # nao achou overlap no fim - verifica se e totalmente redundante (ja existe em algum ponto)
        pos = encontrar_overlap_em_qualquer_ponto(mestre, seg)
        if pos is not None:
            print(f"  [aviso] segmento parece redundante (ja existe a partir da posicao {pos}) - pulado")
            continue

        # sem conexao nenhuma - trata como sessao nova, so concatena
        mestre += seg
        total_adicionado += len(seg)

    salvar_mestre(mestre)
    log = carregar_log()
    log.append({
        'timestamp': datetime.now().isoformat(),
        'arquivo': caminho_arquivo,
        'giros_adicionados': total_adicionado,
        'total_apos': len(mestre),
        'nota': nota
    })
    salvar_log(log)
    print(f"Adicionado: {total_adicionado} giros novos. Total no mestre: {len(mestre)}")
    return len(mestre)

def status():
    mestre = carregar_mestre()
    log = carregar_log()
    print(f"Total de giros no dataset mestre: {len(mestre)}")
    print(f"Total de lotes adicionados: {len(log)}")
    if log:
        print(f"Ultima atualizacao: {log[-1]['timestamp']}")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
    elif sys.argv[1] == 'status':
        status()
    elif sys.argv[1] == 'adicionar' and len(sys.argv) >= 3:
        adicionar_lote(sys.argv[2])
    else:
        print(__doc__)
