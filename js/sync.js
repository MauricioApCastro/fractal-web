'use strict';

/* ============================================================
 * Sync - orquestra a sincronização entre o aparelho e o Drive.
 *
 * Regras:
 *  - o app funciona 100% offline; a sincronização é opcional;
 *  - quem logou com Google só sincroniza a conta dele;
 *  - cada projeto é mesclado pela data de modificação (o mais novo
 *    vence), então dois aparelhos podem trabalhar sem perder nada;
 *  - os ANEXOS também vão para o Drive: cada arquivo vira um arquivo
 *    na pasta visível "Fractal/Anexos", nomeado "<id> - <nome>".
 *    O índice (fractal.json, na pasta oculta) guarda o id do
 *    arquivo no Drive, então o outro aparelho sabe o que baixar.
 *    O mesmo anexo nunca é enviado duas vezes.
 *  - nada é apagado do Drive sem que o anexo tenha sido removido
 *    do projeto (o merge decide).
 * ============================================================ */

const Sync = (() => {
  const FORMATO = 2;

  let situacao = 'local';   // local | pendente | sincronizado | erro
  let mensagem = '';
  let ultimo = null;        // Date da última sincronização bem-sucedida
  let timer = null;
  let rodando = false;
  let destruindo = false;   // true durante a exclusão total de dados
  let ouvintes = [];
  let avisos = [];          // avisos da última sincronização (cota, etc.)
  let cota = null;          // { limite, uso, livre } do Drive

  function config() {
    return (typeof FractalConfig !== 'undefined' && FractalConfig.sync) || {};
  }

  function googleConfig() {
    return (typeof FractalConfig !== 'undefined' && FractalConfig.google) || {};
  }

  function status() {
    return {
      situacao,
      mensagem,
      ultimo,
      avisos: avisos.slice(),
      cota,
      logado: GoogleAuth.logado(),
      email: GoogleAuth.estado().email,
      nome: GoogleAuth.estado().nome,
    };
  }

  function notificar() {
    const s = status();
    ouvintes.forEach(fn => { try { fn(s); } catch (e) { /* ignora */ } });
  }

  function definir(sit, msg) {
    situacao = sit;
    mensagem = msg || '';
    notificar();
  }

  function onChange(fn) {
    ouvintes.push(fn);
    return () => { ouvintes = ouvintes.filter(f => f !== fn); };
  }

  async function projetosLocais() {
    const lista = await Storage.listarProjetos();
    return (lista || []).map(p => JSON.parse(JSON.stringify(p)));
  }

  /* Une as duas listas: mesmo id -> vale o mais recente. */
  function mesclar(local, remoto) {
    const porId = new Map();
    (remoto || []).forEach(p => { if (p && p.id) porId.set(p.id, p); });
    (local || []).forEach(p => {
      if (!p || !p.id) return;
      const atual = porId.get(p.id);
      if (!atual) { porId.set(p.id, p); return; }
      if (String(p.modificado || '') > String(atual.modificado || '')) porId.set(p.id, p);
    });
    return Array.from(porId.values());
  }

  function iguais(a, b) {
    return JSON.stringify(a || []) === JSON.stringify(b || []);
  }

  /* ---------- lápides (exclusões) ---------- */

  /* Apagar um projeto não pode ser "só sumir": o merge une as listas e o
     projeto voltaria do Drive na sincronização seguinte. Cada exclusão vira
     uma lápide { id: { em: ISO } } que viaja no índice e é aplicada nos
     outros aparelhos. A lápide vence a versão do projeto; se o projeto foi
     EDITADO depois da exclusão, a edição vence (o projeto volta). */
  const CHAVE_EXCLUIDOS = 'projetos_excluidos';
  const VALIDADE_LAPIDE_MS = 120 * 24 * 60 * 60 * 1000;   // 120 dias

  async function lerExclusoes() {
    try {
      const m = await Storage.pegarConfig(CHAVE_EXCLUIDOS);
      return (m && typeof m === 'object') ? m : {};
    } catch (e) { return {}; }
  }

  function podarExclusoes(mapa) {
    const limite = Date.now() - VALIDADE_LAPIDE_MS;
    const saida = {};
    Object.keys(mapa || {}).forEach(id => {
      const em = Date.parse((mapa[id] && mapa[id].em) || '');
      if (!isNaN(em) && em >= limite) saida[id] = mapa[id];
    });
    return saida;
  }

  /* Chamado pelo app quando o usuário apaga um projeto. */
  async function registrarExclusao(id) {
    if (!id) return;
    const mapa = await lerExclusoes();
    mapa[id] = { em: new Date().toISOString() };
    await Storage.guardarConfig(CHAVE_EXCLUIDOS, podarExclusoes(mapa)).catch(() => {});
    marcarSujo();
  }

  /* Une as lápides dos dois lados (a mais recente por id). */
  function mesclarExclusoes(local, remoto) {
    const saida = {};
    [remoto, local].forEach(m => {
      Object.keys(m || {}).forEach(id => {
        const novo = m[id] || {};
        const atual = saida[id];
        if (!atual || String(novo.em || '') >= String(atual.em || '')) saida[id] = novo;
      });
    });
    return saida;
  }

  /* ---------- anexos ---------- */

  /* Todos os anexos de arquivo referenciados pelos projetos. */
  function anexosDosProjetos(projetos) {
    const mapa = new Map();
    (projetos || []).forEach(p => {
      if (!p || !p.raiz) return;
      (function andar(miolo) {
        if (!miolo) return;
        (miolo.anexos || []).forEach(a => {
          if (!a || !a.id || !a.arquivo) return;
          if (!mapa.has(a.id)) mapa.set(a.id, a);
        });
        (miolo.itens || []).forEach(i => { if (i.miolo) andar(i.miolo); });
      })(p.raiz);
    });
    return mapa;
  }

  async function aplicarProjetos(projetos) {
    /* Grava a lista sincronizada no IndexedDB, sem apagar o que já
       estava lá (o merge já cuidou disso). */
    await Promise.all(projetos.map(p => Storage.salvarProjeto(p)));
    /* Projeto que sumiu da lista foi apagado em outro aparelho: remove
       também deste (é o que faz a exclusão "chegar" aqui). */
    try {
      const ids = new Set((projetos || []).map(p => p.id));
      const locais = await Storage.listarProjetos();
      for (const p of (locais || [])) {
        if (!ids.has(p.id)) await Storage.apagarProjeto(p.id);
      }
    } catch (e) { /* sem lista local: segue */ }
    /* Atualiza a tela da lista (pode ter vindo projeto novo do Drive). */
    try {
      if (typeof recarregarProjetos === 'function') await recarregarProjetos();
    } catch (e) { /* app.js pode nao estar carregado */ }
  }

  /* ---------- sincronização ---------- */

  async function sincronizar(forcar) {
    if (rodando || destruindo) return status();
    if (!GoogleAuth.logado()) {
      definir('local', 'Entre com o Google para sincronizar.');
      return status();
    }
    rodando = true;
    avisos = [];
    definir('pendente', 'Sincronizando...');
    try {
      const local = await projetosLocais();
      const arquivo = await DriveSync.encontrar();

      let remoto = null;
      if (arquivo) {
        try { remoto = await DriveSync.baixar(arquivo.id); } catch (e) { remoto = null; }
      }

      const projetosRemotos = (remoto && remoto.projetos) || [];
      const mesclados = mesclar(local, projetosRemotos);

      /* --- exclusões (lápides) --- */
      const exclusoesLocais = await lerExclusoes();
      const excluidos = mesclarExclusoes(exclusoesLocais, (remoto && remoto.excluidos) || {});
      const apagarIds = new Set();
      mesclados.forEach(p => {
        const lapide = excluidos[p.id];
        if (!lapide) return;
        if (String(lapide.em || '') >= String(p.modificado || '')) {
          apagarIds.add(p.id);          /* exclusão mais nova: o projeto sai */
        } else {
          delete excluidos[p.id];       /* editado depois: a edição vence */
        }
      });
      const finais = mesclados.filter(p => !apagarIds.has(p.id));
      if (apagarIds.size) {
        for (const id of apagarIds) {
          await Storage.apagarProjeto(id).catch(() => {});
        }
      }
      const excluidosPodados = podarExclusoes(excluidos);
      await Storage.guardarConfig(CHAVE_EXCLUIDOS, excluidosPodados).catch(() => {});

      /* --- anexos --- */
      const usados = anexosDosProjetos(finais);
      const indice = Object.assign({}, (remoto && remoto.anexos) || {});
      const pasta = await DriveSync.pastaAnexos(remoto && remoto.pastaAnexos);
      const arquivos = await DriveSync.listar(pasta.anexos);

      /* o que já está no Drive, indexado pelo id do anexo */
      const noDrive = new Map();
      arquivos.forEach(f => {
        const id = DriveSync.idDoNome(f.nome);
        if (id) noDrive.set(id, f);
      });

      let enviados = 0, baixados = 0, apagados = 0;

      /* --- cota do Drive (antes de enviar, para avisar antes de estourar) --- */
      try {
        cota = await DriveSync.espaco();
        const limite = Number(googleConfig().avisoCota) || 0.8;
        if (cota.limite > 0 && (cota.uso / cota.limite) >= limite) {
          avisos.push('O Drive está quase cheio (' + Math.round((cota.uso / cota.limite) * 100) +
            '% de ' + formatarBytes(cota.limite) + ').');
        }
      } catch (e) { /* cota é só aviso */ }

      for (const [id, anexo] of usados.entries()) {
        const localBlob = await Storage.pegarArquivo(id).catch(() => null);
        const registro = indice[id] || null;
        const arquivoDrive = noDrive.get(id) || (registro && registro.driveId ? { id: registro.driveId } : null);

        if (!localBlob) {
          /* Só tem no Drive: baixa para este aparelho. */
          if (arquivoDrive) {
            try {
              const blob = await DriveSync.baixarBinario(arquivoDrive.id);
              await Storage.guardarArquivo(id, blob);
              indice[id] = Object.assign({}, registro || {}, {
                nome: anexo.nome || (registro && registro.nome) || 'arquivo',
                tipo: anexo.tipo || (registro && registro.tipo) || 'arquivo',
                mime: (blob.type) || (registro && registro.mime) || 'application/octet-stream',
                tam: blob.size,
                driveId: arquivoDrive.id,
              });
              baixados++;
            } catch (e) {
              avisos.push('Não foi possível baixar o anexo "' + (anexo.nome || id) + '".');
            }
          } else if (registro) {
            avisos.push('O anexo "' + (anexo.nome || id) + '" não está mais no Drive.');
          }
          continue;
        }

        /* Tem aqui: garante que esteja no Drive (sem duplicar). */
        if (arquivoDrive && registro && Number(registro.tam) === Number(localBlob.size)) {
          indice[id] = Object.assign({}, registro, { driveId: arquivoDrive.id });
          continue;
        }

        const nome = DriveSync.nomeNoDrive(id, anexo.nome);

        /* Sem espaço no Drive: avisa e deixa o anexo só neste aparelho. */
        if (cota && cota.livre > 0 && localBlob.size > cota.livre) {
          avisos.push('Sem espaço no Drive para "' + (anexo.nome || id) + '" (' +
            formatarBytes(localBlob.size) + '). O anexo ficou só neste aparelho.');
          continue;
        }

        try {
          const enviado = await DriveSync.enviarBinario(
            pasta.anexos, nome,
            localBlob.type || 'application/octet-stream',
            localBlob,
            arquivoDrive && registro ? arquivoDrive.id : null);
          indice[id] = {
            nome: anexo.nome || nome,
            tipo: anexo.tipo || 'arquivo',
            mime: localBlob.type || 'application/octet-stream',
            tam: localBlob.size,
            driveId: (enviado && enviado.id) || (arquivoDrive && arquivoDrive.id) || '',
          };
          enviados++;
        } catch (e) {
          avisos.push('Não foi possível enviar o anexo "' + (anexo.nome || id) + '": ' + (e.message || e));
        }
      }

      /* Anexos que saíram dos projetos: some do índice e do Drive. */
      for (const id of Object.keys(indice)) {
        if (usados.has(id)) continue;
        const reg = indice[id];
        if (reg && reg.driveId) {
          try { await DriveSync.apagarArquivo(reg.driveId); apagados++; } catch (e) { /* ignora */ }
        }
        await Storage.apagarArquivo(id).catch(() => {});
        delete indice[id];
      }

      /* --- cota do Drive (o aviso de "quase cheio" já foi dado acima) --- */

      const mudou = !remoto || !iguais(finais, projetosRemotos) ||
        JSON.stringify(indice) !== JSON.stringify((remoto && remoto.anexos) || {}) ||
        (remoto && remoto.pastaAnexos) !== pasta.anexos ||
        JSON.stringify(excluidosPodados) !== JSON.stringify((remoto && remoto.excluidos) || {});

      if (mudou) {
        const documento = {
          formato: FORMATO,
          rev: ((remoto && Number(remoto.rev)) || 0) + 1,
          atualizado: new Date().toISOString(),
          dispositivo: config().nomeDispositivo || 'desconhecido',
          pastaAnexos: pasta.anexos,
          anexos: indice,
          projetos: finais,
          excluidos: excluidosPodados,
        };
        await DriveSync.enviar(arquivo ? arquivo.id : null, documento);
        await aplicarProjetos(finais);
      } else if (!iguais(local, finais)) {
        /* O Drive está mais novo: copia para o aparelho. */
        await aplicarProjetos(finais);
      }

      ultimo = new Date();
      const partes = [];
      if (enviados) partes.push(enviados + ' anexo(s) enviado(s)');
      if (baixados) partes.push(baixados + ' anexo(s) baixado(s)');
      if (apagados) partes.push(apagados + ' anexo(s) removido(s)');
      definir('sincronizado',
        'Sincronizado com o Google Drive.' + (partes.length ? ' ' + partes.join(', ') + '.' : ''));
      return status();
    } catch (err) {
      let texto = (err && err.message) || 'Falha ao sincronizar.';
      /* 403 de escopo: o token nao tem o Drive. Explica o que fazer. */
      if (/insufficient|scope|permiss/i.test(texto)) {
        texto = 'O Google não liberou o acesso ao Drive. Abra o botão ' +
          '"Autorizar o Drive" e marque TODAS as permissões na tela do Google.';
      }
      definir('erro', texto);
      return status();
    } finally {
      rodando = false;
    }
  }

  function marcarSujo() {
    if (!GoogleAuth.logado()) return;
    definir('pendente', 'Alterações aguardando sincronização.');
    clearTimeout(timer);
    timer = setTimeout(() => { sincronizar(); }, (Number(config().esperaMs) || 4000));
  }

  async function iniciar() {
    await GoogleAuth.restaurarTokens();
    if (GoogleAuth.logado()) {
      definir('pendente', 'Conectado. Sincronizando...');
      await sincronizar();
    } else {
      definir('local', '');
    }
    notificar();
  }

  async function sair() {
    clearTimeout(timer);
    await GoogleAuth.sair();
    definir('local', '');
  }

  /* Apaga todos os dados do Fractal: o que está no Drive (índice +
     pasta visível com os anexos) e o que está neste aparelho
     (projetos, anexos e sessão). Requisito de exclusão de dados
     do titular (LGPD, art. 18). */
  async function apagarTudo() {
    clearTimeout(timer);
    destruindo = true;
    try {
      if (GoogleAuth.logado()) await DriveSync.apagarTudo();
      await GoogleAuth.sair();
      await Storage.limparTudo();
      definir('local', 'Todos os dados foram apagados.');
    } finally {
      destruindo = false;
      rodando = false;
      notificar();
    }
    return true;
  }

  function formatarBytes(b) {
    const n = Number(b) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
    return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  return {
    iniciar,
    sincronizar,
    marcarSujo,
    registrarExclusao,
    sair,
    apagarTudo,
    status,
    onChange,
    mesclar,
    iguais,
    anexosDosProjetos,
    formatarBytes,
  };
})();
