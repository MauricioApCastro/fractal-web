'use strict';

/* ============================================================
 * GoogleAuth - login com Google (OAuth 2.0) e tokens para a Drive API.
 *
 * Dois caminhos:
 *
 *  - WEB (origem https, ex. GitHub Pages): Google Identity Services,
 *    com o botão oficial "Entrar com Google". O token de acesso sai
 *    pela sessão do navegador e é renovado silenciosamente.
 *
 *  - ANDROID (WebView local, origem file://): o Google não aceita
 *    OAuth dentro de um WebView, então o app nativo abre a tela do
 *    Google numa aba do navegador e devolve os tokens (com refresh
 *    token, o login dura meses) pela ponte fractalBridge.
 *
 * Escopo usado: drive.appdata (não sensível). Os dados ficam na
 * pasta oculta do app dentro do Drive do usuário.
 * ============================================================ */

const GoogleAuth = (() => {
  const CHAVE_TOKENS = 'google_tokens';

  let cfg = (typeof FractalConfig !== 'undefined' && FractalConfig.google) || {};
  let tokens = null;
  let estado = { logado: false, email: '', nome: '', origem: '', erro: '' };
  let ouvintes = [];
  let resolverPendente = null;

  /* ---------- utilidades ---------- */

  function config() { return cfg || {}; }
  function scopes() { return (config().scopes || []).join(' '); }

  function notificar() {
    ouvintes.forEach(fn => { try { fn(estado); } catch (e) { /* ignora */ } });
  }

  function temPonteNativa() {
    return typeof window.fractalBridge !== 'undefined'
      && typeof window.fractalBridge.onGoogleSignIn === 'function';
  }

  /* No Android o client id vem do nativo (strings.xml), assim nao ha
     risco de o app e o web usarem credenciais diferentes. */
  function configNativa() {
    try {
      if (!temPonteNativa()) return null;
      if (typeof window.fractalBridge.getGoogleConfig !== 'function') return null;
      const bruto = window.fractalBridge.getGoogleConfig();
      if (!bruto) return null;
      return JSON.parse(bruto);
    } catch (e) { return null; }
  }

  function clientId() {
    const nativo = configNativa();
    if (nativo && nativo.clientId && nativo.configurado) return nativo.clientId;
    return config().androidClientId || config().webClientId || '';
  }

  function temWebClient() {
    // No app Android quem faz o login é o nativo (Custom Tab): o Google
    // recusa OAuth dentro de WebView, mesmo com origin file://.
    if (temPonteNativa()) return false;
    return !!(config().webClientId) && window.isSecureContext === true;
  }

  function aleatorio(bytes) {
    const buf = new Uint8Array(bytes);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    return Array.from(buf).map(b => ('0' + b.toString(16)).slice(-2)).join('');
  }

  function base64Url(buffer) {
    let bin = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function desafio(verifier) {
    const dados = new TextEncoder().encode(verifier);
    const dig = await window.crypto.subtle.digest('SHA-256', dados);
    return base64Url(dig);
  }

  function decodificarJwt(jwt) {
    try {
      const parte = String(jwt || '').split('.')[1];
      if (!parte) return {};
      let b64 = parte.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      return JSON.parse(decodeURIComponent(escape(atob(b64))));
    } catch (e) { return {}; }
  }

  function expiracao(expiresIn) {
    // 60s de folga para o token não expirar no meio de uma requisição.
    return Date.now() + Math.max(60, (Number(expiresIn) || 3600) - 60) * 1000;
  }

  /* ---------- persistência dos tokens ---------- */

  async function guardarTokens(t) {
    tokens = t;
    estado = {
      logado: !!t,
      email: (t && t.email) || '',
      nome: (t && t.nome) || '',
      origem: (t && t.origem) || '',
      erro: '',
    };
    if (t) await Storage.guardarConfig(CHAVE_TOKENS, t);
    else await Storage.apagarConfig(CHAVE_TOKENS).catch(() => {});
    notificar();
    return estado;
  }

  async function restaurarTokens() {
    try {
      const t = await Storage.pegarConfig(CHAVE_TOKENS);
      if (t && t.access_token) {
        tokens = t;
        estado = {
          logado: true,
          email: t.email || '',
          nome: t.nome || '',
          origem: t.origem || '',
          erro: '',
        };
        notificar();
        verificarEscopos().catch(() => {});
        return true;
      }
    } catch (e) { /* sem tokens: segue offline */ }
    return false;
  }

  /* ---------- caminho web (Google Identity Services) ---------- */

  let gisCarregado = false;

  function carregarGis() {
    if (gisCarregado && window.google && window.google.accounts) return Promise.resolve(true);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.defer = true;
      s.onload = () => { gisCarregado = true; resolve(true); };
      s.onerror = () => reject(new Error('Não foi possível carregar o login do Google. Verifique a internet.'));
      document.head.appendChild(s);
    });
  }

  function pedirTokenWeb(forcarConsentimento) {
    return new Promise((resolve, reject) => {
      try {
        const client = google.accounts.oauth2.initTokenClient({
          client_id: config().webClientId,
          scope: scopes(),
          prompt: forcarConsentimento ? 'consent' : '',
          callback: (res) => {
            if (res && res.error) {
              reject(new Error(res.error_description || res.error));
              return;
            }
            resolve({
              access_token: res.access_token,
              expires_at: expiracao(res.expires_in),
              refresh_token: null,
              origem: 'web',
            });
          },
          error_callback: (err) => reject(new Error((err && err.message) || 'Falha ao pedir acesso ao Google.')),
        });
        client.requestAccessToken({ prompt: forcarConsentimento ? 'consent' : '' });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Mostra o botão oficial do Google no elemento indicado.
   * Devolve uma promise resolvida quando o login terminar.
   */
  async function entrarWeb(alvo) {
    await carregarGis();
    return new Promise((resolve, reject) => {
      google.accounts.id.initialize({
        client_id: config().webClientId,
        callback: async (res) => {
          try {
            const info = decodificarJwt(res && res.credential);
            let token = await pedirTokenWeb(false).catch(() => pedirTokenWeb(true));
            token.email = info.email || '';
            token.nome = info.name || info.email || '';
            await guardarTokens(token);
            resolve(estado);
          } catch (err) {
            reject(err);
          }
        },
      });
      google.accounts.id.renderButton(alvo, {
        theme: 'filled_black',
        size: 'large',
        shape: 'pill',
        text: 'continue_with',
        width: 280,
      });
    });
  }

  /* ---------- escopos realmente concedidos ---------- */

  /* O Google pode devolver um token SEM os escopos do Drive (acontece quando
     as caixas de permissao sao desmarcadas na tela de consentimento). O
     tokeninfo diz exatamente o que foi concedido - e a unica forma de saber,
     porque o token em si e opaco. */
  let escoposConcedidos = [];

  function escoposDrivePedidos() {
    return (config().scopes || []).filter(s => /\/auth\/drive\./.test(s));
  }

  async function verificarEscopos() {
    escoposConcedidos = [];
    if (!tokens || !tokens.access_token) return null;
    let j = null;
    try {
      const r = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' +
        encodeURIComponent(tokens.access_token));
      if (r.ok) j = await r.json();
    } catch (e) { /* sem rede: nao da para saber */ }
    if (!j || typeof j.scope !== 'string') return null;   // nao mexe no estado

    escoposConcedidos = j.scope.split(/\s+/).filter(Boolean);
    const faltando = escoposDrivePedidos().filter(s => !escoposConcedidos.includes(s));
    if (faltando.length) {
      estado = Object.assign({}, estado, {
        faltandoDrive: true,
        escopos: escoposConcedidos,
        erro: 'O Google não liberou o acesso ao Drive. Toque em "Autorizar o Drive" e marque TODAS as permissões.',
      });
    } else {
      estado = Object.assign({}, estado, {
        faltandoDrive: false,
        escopos: escoposConcedidos,
        erro: /não liberou o acesso ao Drive/.test(estado.erro || '') ? '' : estado.erro,
      });
    }
    notificar();
    return escoposConcedidos;
  }

  /* ---------- caminho nativo (Android) ---------- */

  async function entrarNativo(forcarConsentimento) {
    if (!temPonteNativa()) throw new Error('O login nativo não está disponível neste ambiente.');
    const nativo = configNativa();
    if (nativo && nativo.configurado === false) {
      throw new Error('O login do Google ainda não está configurado neste build. ' +
        'É preciso o client id Android (ver SYNC-SETUP.md).');
    }
    const verifier = aleatorio(48);
    const state = aleatorio(16);
    await Storage.guardarConfig('google_pkce', { verifier, state, em: Date.now() }).catch(() => {});

    /* Sem refresh token ainda: pede consentimento para o Google emitir um.
       Com forcarConsentimento = true a tela de permissoes volta a aparecer
       (usado quando o Google nao liberou o Drive na primeira vez). */
    const forcar = !!forcarConsentimento || !(tokens && tokens.refresh_token);

    return new Promise((resolve, reject) => {
      resolverPendente = { resolve, reject };
      try {
        window.fractalBridge.onGoogleSignIn(verifier, state, scopes(), forcar ? 'true' : 'false');
      } catch (err) {
        resolverPendente = null;
        reject(err);
      }
    });
  }

  /* O app nativo devolve o resultado por esta função global. */
  async function processarResultado(payload) {
    const pendente = resolverPendente;
    resolverPendente = null;
    try {
      if (!payload) return;
      if (payload.erro) throw new Error(String(payload.erro));

      /* O state tem de bater com o do pedido feito por este aparelho: sem
         isso, outro app poderia injetar um login que o usuario nao pediu. */
      const guardado = await Storage.pegarConfig('google_pkce').catch(() => null);
      await Storage.apagarConfig('google_pkce').catch(() => {});
      if (!guardado || !payload.state || guardado.state !== payload.state) {
        throw new Error('A resposta do Google não confere. Tente de novo.');
      }

      const token = {
        access_token: payload.access_token,
        refresh_token: payload.refresh_token || null,
        expires_at: expiracao(payload.expires_in),
        origem: 'android',
        email: payload.email || '',
        nome: payload.nome || '',
      };
      await guardarTokens(token);
      /* Confere no Google se o Drive veio mesmo liberado. */
      try { await verificarEscopos(); } catch (e) { /* diagnostico opcional */ }
      if (pendente) pendente.resolve(estado);
    } catch (err) {
      estado = Object.assign({}, estado, { erro: String(err.message || err) });
      notificar();
      if (pendente) pendente.reject(err);
    }
  }

  /* Fila do index.html: o redirect pode chegar antes dos scripts carregarem. */
  window.__fractalGoogleAuthProcessar = processarResultado;
  (function drenarFila() {
    const fila = window.__fractalGoogleAuthFila || [];
    while (fila.length) processarResultado(fila.shift());
  })();

  /* ---------- renovar o token ---------- */

  /* Sync e anexos pedem token ao mesmo tempo; com o token vencido, cada um
     faria sua propria renovacao. Todos esperam a mesma. */
  let renovacaoEmCurso = null;

  function renovarComRefresh() {
    if (!renovacaoEmCurso) {
      renovacaoEmCurso = renovarAgora().finally(() => { renovacaoEmCurso = null; });
    }
    return renovacaoEmCurso;
  }

  async function renovarAgora() {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: clientId(),
      }).toString(),
    });
    if (!res.ok) throw new Error('Sessão expirada. Entre com o Google novamente.');
    const j = await res.json();
    tokens.access_token = j.access_token;
    tokens.expires_at = expiracao(j.expires_in);
    await Storage.guardarConfig(CHAVE_TOKENS, tokens);
    return tokens.access_token;
  }

  async function accessToken() {
    if (!tokens || !tokens.access_token) return null;
    if (!tokens.expires_at || tokens.expires_at > Date.now()) return tokens.access_token;

    if (tokens.refresh_token) {
      return renovarComRefresh();
    }

    /* Web: renova silenciosamente enquanto a sessão do navegador viver. */
    if (tokens.origem === 'web' && temWebClient()) {
      try {
        const novo = await pedirTokenWeb(false);
        tokens.access_token = novo.access_token;
        tokens.expires_at = novo.expires_at;
        await Storage.guardarConfig(CHAVE_TOKENS, tokens);
        return tokens.access_token;
      } catch (e) {
        throw new Error('Sua sessão do Google expirou. Entre novamente.');
      }
    }

    throw new Error('Sua sessão do Google expirou. Entre novamente.');
  }

  /* ---------- sair ---------- */

  /* Revoga no Google: sem isso o refresh token continuaria valido por
     meses depois de sair, mesmo apagado do aparelho. */
  async function revogar(t) {
    const token = t && (t.refresh_token || t.access_token);
    if (!token) return;
    try {
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }).toString(),
      });
    } catch (e) { /* sem rede: o token some do aparelho mesmo assim */ }
  }

  async function sair() {
    await revogar(tokens);
    try {
      if (window.google && window.google.accounts && window.google.accounts.id) {
        window.google.accounts.id.disableAutoSelect();
      }
    } catch (e) { /* ignora */ }
    await guardarTokens(null);
    return estado;
  }

  return {
    config,
    clientId,
    scopes,
    estado: () => Object.assign({}, estado),
    logado: () => !!(tokens && tokens.access_token),
    temPonteNativa,
    temWebClient,
    restaurarTokens,
    entrarWeb,
    entrarNativo,
    accessToken,
    verificarEscopos,
    escoposConcedidos: () => escoposConcedidos.slice(),
    faltandoDrive: () => !!estado.faltandoDrive,
    sair,
    onChange: (fn) => { ouvintes.push(fn); return () => { ouvintes = ouvintes.filter(f => f !== fn); }; },
    notificar,
  };
})();
