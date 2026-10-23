'use strict';

/* ============================================================
 * Configuração do Fractal (web).
 *
 * Os IDs de cliente OAuth são públicos (não são segredos): o
 * "client secret" nunca entra no app. Preencha aqui depois de
 * criar o projeto no Google Cloud (ver ../SYNC-SETUP.md).
 *
 *  - webClientId:     OAuth 2.0 > "Web application" (usado no Chrome)
 *  - androidClientId: OAuth 2.0 > "Android" (usado pelo app Android)
 *
 * Enquanto estiverem vazios o app continua funcionando 100% local:
 * o login é apenas um recurso opcional.
 * ============================================================ */

const FractalConfig = {
  google: {
    webClientId: '294020392329-vei375320terek71auhtm50vge5o1u7f.apps.googleusercontent.com',
    androidClientId: '294020392329-e2lu6k3f8isfq5fk59jctdmuf8mrppfg.apps.googleusercontent.com',

    // Escopos: todos NÃO sensíveis, então o Google não exige
    // verificação do app (nem avaliação de segurança) e não há custo.
    //  - drive.appdata: pasta oculta do app, onde fica o índice
    //    (fractal.json) que liga os aparelhos;
    //  - drive.file: acesso só aos arquivos que o próprio app cria
    //    (a pasta visível "Fractal" com os anexos).
    scopes: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/drive.appdata',
      'https://www.googleapis.com/auth/drive.file',
    ],

    // Nome do arquivo guardado na pasta oculta do Drive.
    arquivoDados: 'fractal.json',

    // Pasta visível no Drive onde ficam os anexos. Você consegue
    // abrir e baixar os arquivos de lá pelo Drive do PC/celular.
    pastaAnexos: 'Fractal',
    subPastaAnexos: 'Anexos',

    // Avisa quando o Drive está quase cheio (fração da cota usada).
    avisoCota: 0.8,
  },

  sync: {
    // Espera antes de enviar as alterações para o Drive (debounce).
    esperaMs: 4000,
    // Nome do dispositivo mostrado na sincronização.
    nomeDispositivo: 'navegador',
  },
};
