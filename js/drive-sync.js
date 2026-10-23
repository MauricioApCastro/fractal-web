'use strict';

/* ============================================================
 * DriveSync - leitura/escrita no Google Drive.
 *
 * Duas áreas, com(finalidade) diferentes:
 *
 *  1) PASTA OCULTA DO APP (appDataFolder, escopo drive.appdata)
 *     - fractal.json: o índice com os projetos e a lista dos
 *       anexos. Fica escondido do usuário e serve de âncora
 *       entre os aparelhos (celular e PC).
 *
 *  2) PASTA VISÍVEL "Fractal" (escopo drive.file)
 *     - Anexos/: os arquivos dos anexos (fotos, vídeos, docs).
 *       Você abre e baixa pelo Drive do PC ou do celular.
 *       Só o app vê esses arquivos (drive.file), mas eles são seus.
 *
 * Upload:
 *   - até 5 MB  -> multipart (uma requisição);
 *   - acima    -> resumable em pedaços de 4 MB, que sobrevive a
 *                 queda de internet no meio do envio.
 *
 * Todo o tráfego sai daqui com o token do Google.
 * ============================================================ */

const DriveSync = (() => {
  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

  const MIME_PASTA = 'application/vnd.google-apps.folder';
  const LIMITE_SIMPLES = 5 * 1024 * 1024;   // 5 MB
  const TAM_PECA = 4 * 1024 * 1024;          // 4 MB (multiplo de 256 KB)

  function cfg() {
    return (typeof FractalConfig !== 'undefined' && FractalConfig.google) || {};
  }

  function arquivo() {
    return cfg().arquivoDados || 'fractal.json';
  }

  function nomePasta() {
    return cfg().pastaAnexos || 'Fractal';
  }

  function nomeSubPasta() {
    return cfg().subPastaAnexos || 'Anexos';
  }

  async function cabecalhos(extra) {
    const token = await GoogleAuth.accessToken();
    if (!token) throw new Error('Não há sessão do Google ativa.');
    return Object.assign({ Authorization: 'Bearer ' + token }, extra || {});
  }

  async function erroDe(res) {
    let detalhe = '';
    try {
      const j = await res.json();
      detalhe = (j.error && (j.error.message || j.error.status)) || '';
    } catch (e) { /* corpo não json */ }
    if (res.status === 401) return new Error('Sessão do Google expirou. Entre novamente.');
    if (res.status === 403) {
      const msg = detalhe || 'verifique o consentimento.';
      if (/insufficient|permission|notAuthorized|forbidden/i.test(msg)) {
        return new Error('O Google não liberou o acesso a estes arquivos: ' + msg);
      }
      return new Error('Sem permissão no Drive: ' + msg);
    }
    if (res.status === 404) return new Error('Arquivo não encontrado no Drive.');
    return new Error('Drive: ' + (detalhe || ('erro ' + res.status)));
  }

  /* ---------- 1) índice na pasta oculta ---------- */

  /* Procura o arquivo do app na pasta oculta. */
  async function encontrar() {
    const q = encodeURIComponent("name = '" + arquivo() + "' and trashed = false");
    const campos = encodeURIComponent('files(id,name,modifiedTime,size,appProperties)');
    const url = API + '/files?spaces=appDataFolder&q=' + q + '&fields=' + campos + '&pageSize=10';
    const res = await fetch(url, { headers: await cabecalhos() });
    if (!res.ok) throw await erroDe(res);
    const j = await res.json();
    const lista = j.files || [];
    return lista.length ? lista[0] : null;
  }

  /* Baixa o conteúdo (JSON) do arquivo. */
  async function baixar(id) {
    const url = API + '/files/' + encodeURIComponent(id) + '?alt=media';
    const res = await fetch(url, { headers: await cabecalhos() });
    if (!res.ok) throw await erroDe(res);
    const texto = await res.text();
    try { return JSON.parse(texto); }
    catch (e) { throw new Error('O arquivo no Drive está corrompido.'); }
  }

  /* Envia (cria ou atualiza) o documento. */
  async function enviar(id, documento) {
    const conteudo = JSON.stringify(documento);
    const meta = {
      name: arquivo(),
      parents: ['appDataFolder'],
      appProperties: {
        rev: String(documento.rev || 0),
        atualizado: String(documento.atualizado || ''),
      },
    };
    const limite = 'fractal-upload-' + Math.random().toString(36).slice(2);
    const corpo =
      '--' + limite + '\r\n' +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(meta) + '\r\n' +
      '--' + limite + '\r\n' +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      conteudo + '\r\n' +
      '--' + limite + '--';

    const url = id
      ? UPLOAD + '/' + encodeURIComponent(id) + '?uploadType=multipart&fields=' + encodeURIComponent('id,modifiedTime,appProperties')
      : UPLOAD + '?uploadType=multipart&fields=' + encodeURIComponent('id,modifiedTime,appProperties');

    const res = await fetch(url, {
      method: id ? 'PATCH' : 'POST',
      headers: await cabecalhos({ 'Content-Type': 'multipart/related; boundary=' + limite }),
      body: corpo,
    });
    if (!res.ok) throw await erroDe(res);
    return await res.json();
  }

  /* ---------- 2) pasta visível dos anexos ---------- */

  /* Procura uma pasta pelo nome dentro de outra (ou na raiz). */
  async function acharPasta(nome, paiId) {
    const q = encodeURIComponent(
      "name = '" + nome.replace(/'/g, "\\'") + "'" +
      " and mimeType = '" + MIME_PASTA + "'" +
      (paiId ? " and '" + paiId + "' in parents" : " and 'root' in parents") +
      ' and trashed = false');
    const campos = encodeURIComponent('files(id,name)');
    const url = API + '/files?q=' + q + '&fields=' + campos + '&pageSize=10';
    const res = await fetch(url, { headers: await cabecalhos() });
    if (!res.ok) throw await erroDe(res);
    const j = await res.json();
    const lista = j.files || [];
    return lista.length ? lista[0] : null;
  }

  /* Cria uma pasta dentro de outra (ou na raiz). */
  async function criarPasta(nome, paiId) {
    const meta = {
      name: nome,
      mimeType: MIME_PASTA,
      parents: [paiId || 'root'],
    };
    const url = API + '/files?fields=' + encodeURIComponent('id,name');
    const res = await fetch(url, {
      method: 'POST',
      headers: await cabecalhos({ 'Content-Type': 'application/json; charset=UTF-8' }),
      body: JSON.stringify(meta),
    });
    if (!res.ok) throw await erroDe(res);
    return await res.json();
  }

  /* Pasta "Círculos" + subpasta "Anexos". Reaproveita se já existirem. */
  async function pastaAnexos(idConhecida) {
    if (idConhecida) {
      try {
        const res = await fetch(API + '/files/' + encodeURIComponent(idConhecida) + '?fields=' + encodeURIComponent('id,name'),
          { headers: await cabecalhos() });
        if (res.ok) {
          const j = await res.json();
          const sub = await acharPasta(nomeSubPasta(), j.id);
          if (sub) return { pasta: j.id, anexos: sub.id };
        }
      } catch (e) { /* id velha: recria abaixo */ }
    }
    let pasta = await acharPasta(nomePasta(), null);
    if (!pasta) pasta = await criarPasta(nomePasta(), null);
    let sub = await acharPasta(nomeSubPasta(), pasta.id);
    if (!sub) sub = await criarPasta(nomeSubPasta(), pasta.id);
    return { pasta: pasta.id, anexos: sub.id };
  }

  /* Lista os arquivos de uma pasta: [{id, nome, tam, mime}] */
  async function listar(pastaId) {
    const out = [];
    let token = null;
    do {
      const q = encodeURIComponent("'" + pastaId + "' in parents and trashed = false");
      const campos = encodeURIComponent('nextPageToken,files(id,name,size,mimeType)');
      const url = API + '/files?q=' + q + '&fields=' + campos + '&pageSize=200' +
        (token ? '&pageToken=' + encodeURIComponent(token) : '');
      const res = await fetch(url, { headers: await cabecalhos() });
      if (!res.ok) throw await erroDe(res);
      const j = await res.json();
      (j.files || []).forEach(f => out.push({
        id: f.id,
        nome: f.name || '',
        tam: Number(f.size) || 0,
        mime: f.mimeType || 'application/octet-stream',
      }));
      token = j.nextPageToken || null;
    } while (token);
    return out;
  }

  /* Nome do arquivo no Drive: "<id do anexo> - <nome original>".
     O id na frente garante unicidade e permite achar o arquivo
     pelo indice sem depender de id do Drive. */
  function nomeNoDrive(idAnexo, nomeOriginal) {
    const limpo = String(nomeOriginal || 'arquivo').replace(/[\/\\]/g, '_').slice(0, 120);
    return idAnexo + ' - ' + limpo;
  }

  function idDoNome(nome) {
    const i = String(nome || '').indexOf(' - ');
    return i > 0 ? nome.slice(0, i) : '';
  }

  /* Envia o binário de um anexo. */
  async function enviarBinario(pastaId, nome, mime, blob, arquivoIdExistente) {
    if (arquivoIdExistente) {
      /* Substitui o conteúdo de um arquivo que já existe. */
      const url = UPLOAD + '/' + encodeURIComponent(arquivoIdExistente) + '?uploadType=media&fields=' + encodeURIComponent('id,name,size');
      const res = await fetch(url, {
        method: 'PATCH',
        headers: await cabecalhos({ 'Content-Type': mime || 'application/octet-stream' }),
        body: blob,
      });
      if (!res.ok) throw await erroDe(res);
      return await res.json();
    }

    if (blob.size <= LIMITE_SIMPLES) {
      const meta = { name: nome, parents: [pastaId] };
      const limite = 'fractal-bin-' + Math.random().toString(36).slice(2);
      const corpo = new Blob([
        '--' + limite + '\r\n',
        'Content-Type: application/json; charset=UTF-8\r\n\r\n',
        JSON.stringify(meta), '\r\n',
        '--' + limite + '\r\n',
        'Content-Type: ' + (mime || 'application/octet-stream') + '\r\n\r\n',
        blob, '\r\n',
        '--' + limite + '--',
      ], { type: 'multipart/related; boundary=' + limite });

      const url = UPLOAD + '?uploadType=multipart&fields=' + encodeURIComponent('id,name,size,mimeType');
      const res = await fetch(url, {
        method: 'POST',
        headers: await cabecalhos({ 'Content-Type': 'multipart/related; boundary=' + limite }),
        body: corpo,
      });
      if (!res.ok) throw await erroDe(res);
      return await res.json();
    }

    /* Arquivo grande: upload resumable em pedaços. */
    const meta = { name: nome, parents: [pastaId] };
    const url = UPLOAD + '?uploadType=resumable&fields=' + encodeURIComponent('id,name,size,mimeType');
    const res = await fetch(url, {
      method: 'POST',
      headers: await cabecalhos({
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mime || 'application/octet-stream',
        'X-Upload-Content-Length': String(blob.size),
      }),
      body: JSON.stringify(meta),
    });
    if (!res.ok) throw await erroDe(res);
    const sessao = res.headers.get('Location');
    if (!sessao) throw new Error('O Drive não devolveu a sessão de envio.');

    let inicio = 0;
    while (inicio < blob.size) {
      const fim = Math.min(inicio + TAM_PECA, blob.size);
      const peca = blob.slice(inicio, fim);
      const r = await fetch(sessao, {
        method: 'PUT',
        headers: {
          'Content-Length': String(peca.size),
          'Content-Range': 'bytes ' + inicio + '-' + (fim - 1) + '/' + blob.size,
        },
        body: peca,
      });
      if (r.status === 308) { inicio = fim; continue; }
      if (!r.ok) throw await erroDe(r);
      return await r.json();
    }
    throw new Error('O envio do arquivo não foi concluído.');
  }

  /* Baixa o binário de um anexo. */
  async function baixarBinario(arquivoId) {
    const url = API + '/files/' + encodeURIComponent(arquivoId) + '?alt=media';
    const res = await fetch(url, { headers: await cabecalhos() });
    if (!res.ok) throw await erroDe(res);
    return await res.blob();
  }

  /* Apaga um arquivo do Drive. */
  async function apagarArquivo(arquivoId) {
    const url = API + '/files/' + encodeURIComponent(arquivoId);
    const res = await fetch(url, { method: 'DELETE', headers: await cabecalhos() });
    if (!res.ok && res.status !== 404) throw await erroDe(res);
    return true;
  }

  /* Apaga uma pasta e tudo que está dentro dela. */
  async function apagarArvore(pastaId) {
    const filhos = await listar(pastaId);
    for (const f of filhos) {
      if (f.mime === MIME_PASTA) await apagarArvore(f.id);
      else await apagarArquivo(f.id);
    }
    await apagarArquivo(pastaId);
  }

  /* Apaga tudo que o app criou no Drive (LGPD, art. 18):
     o índice da pasta oculta e a pasta visível com os anexos. */
  async function apagarTudo() {
    const idx = await encontrar();
    if (idx) await apagarArquivo(idx.id);
    const pasta = await acharPasta(nomePasta(), null);
    if (pasta) await apagarArvore(pasta.id);
    return true;
  }

  /* Espaço usado no Drive (para os alertas de cota). */
  async function espaco() {
    const url = API + '/about?fields=' + encodeURIComponent('storageQuota');
    const res = await fetch(url, { headers: await cabecalhos() });
    if (!res.ok) throw await erroDe(res);
    const j = await res.json();
    const q = (j.storageQuota || {});
    const limite = Number(q.limit) || 0;
    const uso = Number(q.usage) || 0;
    return { limite, uso, livre: Math.max(0, limite - uso) };
  }

  return {
    encontrar, baixar, enviar, arquivo,
    pastaAnexos, listar, nomeNoDrive, idDoNome,
    enviarBinario, baixarBinario, apagarArquivo, apagarTudo, espaco,
  };
})();
