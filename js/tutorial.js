'use strict';

/* ============================================================
 * Tutorial - explica o Fractal na primeira abertura.
 *
 * O conceito (círculos dentro de círculos) não é óbvio: sem esta
 * apresentação muita gente desinstala antes de entender. Aparece
 * sozinho só quando não há nenhum projeto e o tutorial ainda não
 * foi visto; depois fica no rodapé, em "Como usar".
 * ============================================================ */

const Tutorial = (() => {
  const CHAVE = 'tutorial_visto_v1';

  /* Figuras simples em SVG, desenhadas com as cores do app. */
  const FIG_FLOR = '<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="20" fill="#F5A623"/>' +
    '<circle cx="60" cy="22" r="13" fill="#4FA8FF"/><circle cx="96" cy="48" r="13" fill="#B26BFF"/>' +
    '<circle cx="83" cy="92" r="13" fill="#FF6BB3"/><circle cx="37" cy="92" r="13" fill="#38D9A9"/>' +
    '<circle cx="24" cy="48" r="13" fill="#FFA446"/></svg>';
  const FIG_DENTRO = '<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="50" fill="none" stroke="#4FA8FF" stroke-width="3"/>' +
    '<circle cx="60" cy="60" r="14" fill="#4FA8FF"/><circle cx="60" cy="30" r="9" fill="#B26BFF"/>' +
    '<circle cx="86" cy="68" r="9" fill="#FF6BB3"/><circle cx="34" cy="68" r="9" fill="#38D9A9"/></svg>';
  const FIG_GESTO = '<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="30" fill="#F5A623" opacity="0.35"/>' +
    '<circle cx="60" cy="60" r="16" fill="#F5A623"/><circle cx="28" cy="88" r="9" fill="#E6EDF3"/>' +
    '<circle cx="92" cy="32" r="9" fill="#E6EDF3"/><path d="M36 80 L50 66 M84 40 L70 54" stroke="#E6EDF3" stroke-width="4" stroke-linecap="round"/></svg>';
  const FIG_META = '<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="40" fill="none" stroke="#2A3350" stroke-width="10"/>' +
    '<circle cx="60" cy="60" r="40" fill="none" stroke="#2DA44E" stroke-width="10" stroke-dasharray="176 252" transform="rotate(-90 60 60)"/>' +
    '<text x="60" y="68" text-anchor="middle" font-size="24" font-weight="700" fill="#E6EDF3">70%</text></svg>';
  const FIG_NUVEM = '<svg viewBox="0 0 120 120"><path d="M34 82 a18 18 0 0 1 4-35 a24 24 0 0 1 46 6 a15 15 0 0 1 2 29 z" fill="#1F6FEB"/>' +
    '<path d="M50 66 l8 8 l16-18" stroke="#E6EDF3" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const PASSOS = [
    {
      figura: FIG_FLOR,
      titulo: 'Bem-vindo ao Fractal',
      texto: 'Cada projeto é um círculo central com os seus itens em volta: etapas, tarefas, ideias ou cômodos de uma obra.',
    },
    {
      figura: FIG_DENTRO,
      titulo: 'Todo círculo tem um interior',
      texto: 'Toque num círculo para entrar nele e criar subitens, sem limite de níveis. O caminho no topo mostra onde você está.',
    },
    {
      figura: FIG_GESTO,
      titulo: 'Toque longo, pinça e arraste',
      texto: 'Segure um círculo para editar, concluir, anexar fotos e arquivos ou transformá-lo em meta. Use a pinça para o zoom e o botão voltar para subir um nível.',
    },
    {
      figura: FIG_META,
      titulo: 'Metas com progresso diário',
      texto: 'Uma meta conta dias (por exemplo, 30 dias de caminhada) ou tem prazo. Registre cada dia e acompanhe a porcentagem no anel.',
    },
    {
      figura: FIG_NUVEM,
      titulo: 'Seus dados são seus',
      texto: 'Tudo fica no seu aparelho e funciona sem internet. Se quiser usar em outros aparelhos, entre com o Google em "Conta": a cópia vai para o seu próprio Drive.',
    },
  ];

  let passo = 0;

  function el(id) { return document.getElementById(id); }

  function aberto() {
    const ov = el('tutorial-overlay');
    return !!ov && !ov.hidden;
  }

  function botao(texto, classe, acao) {
    const b = document.createElement('button');
    b.className = 'btn ' + classe;
    b.textContent = texto;
    b.addEventListener('click', acao);
    return b;
  }

  function render() {
    const p = PASSOS[passo];
    el('tutorial-figura').innerHTML = p.figura;
    el('tutorial-titulo').textContent = p.titulo;
    el('tutorial-texto').textContent = p.texto;

    const pontos = el('tutorial-pontos');
    pontos.replaceChildren(...PASSOS.map((_, i) => {
      const s = document.createElement('span');
      if (i === passo) s.className = 'ativo';
      return s;
    }));

    const acoes = el('tutorial-acoes');
    const ultimo = passo === PASSOS.length - 1;
    if (ultimo) {
      acoes.replaceChildren(
        botao('Começar do zero', 'btn-texto', () => fechar()),
        botao('Ver um exemplo', 'btn-primario', () => { fechar(); criarExemplo(); })
      );
    } else {
      acoes.replaceChildren(
        botao('Pular', 'btn-texto', () => fechar()),
        botao('Próximo', 'btn-primario', () => { passo++; render(); })
      );
    }
  }

  function abrir() {
    passo = 0;
    render();
    el('tutorial-overlay').hidden = false;
  }

  function fechar() {
    el('tutorial-overlay').hidden = true;
    Storage.guardarConfig(CHAVE, true).catch(() => {});
  }

  /* Projeto de exemplo: mostra níveis, conclusão, notas e os dois tipos de meta. */
  async function criarExemplo() {
    const hoje = dataLocalISO();
    const raiz = novoMiolo('Reforma da casa (exemplo)');
    raiz.anotacoes = 'Projeto de exemplo. Explore à vontade e apague quando quiser pelo × na lista de projetos.';

    const cozinha = novoItem('Cozinha', 0);
    cozinha.miolo.itens = [novoItem('Pintura', 1), novoItem('Armários', 2), novoItem('Iluminação', 3)];
    marcarConcluido(cozinha.miolo.itens[1], true);

    const banheiro = novoItem('Banheiro', 2);
    banheiro.miolo.itens = [novoItem('Trocar o piso', 4), novoItem('Box de vidro', 5)];

    const orcamento = novoItem('Orçamento', 5);
    orcamento.anotacoes = 'Anote aqui valores, fornecedores e prazos combinados.';

    const caminhar = novoItem('Caminhar 30 dias', 6);
    caminhar.meta = criarMeta(30, hoje, 'contagem');
    caminhar.meta.progresso = 4;

    const mudanca = novoItem('Mudar em 45 dias', 8);
    mudanca.meta = criarMeta(45, hoje, 'prazo');

    raiz.itens = [cozinha, banheiro, orcamento, caminhar, mudanca];

    const projeto = {
      id: novoId(),
      nome: 'Reforma da casa (exemplo)',
      modificado: new Date().toISOString(),
      raiz,
    };
    await Storage.salvarProjeto(projeto);
    await recarregarProjetos();
    if (typeof Sync !== 'undefined' && Sync && Sync.marcarSujo) Sync.marcarSujo();
    if (typeof Lembrete !== 'undefined' && Lembrete) Lembrete.informar();
    irParaFlor(projeto);
    toast('Toque num círculo para entrar nele.');
  }

  async function talvezMostrar() {
    try {
      if (Estado.projetos && Estado.projetos.length) return;
      const visto = await Storage.pegarConfig(CHAVE);
      if (!visto) abrir();
    } catch (e) { /* sem tutorial: o app segue normal */ }
  }

  /* O app.js termina de carregar a lista de forma assíncrona; espera ele
     marcar "ready" antes de decidir se mostra o tutorial. */
  function quandoPronto(fn, tentativas) {
    if (document.documentElement.dataset.ready === '1') { fn(); return; }
    if ((tentativas || 0) > 100) return;
    setTimeout(() => quandoPronto(fn, (tentativas || 0) + 1), 100);
  }

  const btnAjuda = el('btn-ajuda');
  if (btnAjuda) btnAjuda.addEventListener('click', abrir);
  quandoPronto(talvezMostrar);

  return { abrir, fechar, aberto };
})();
