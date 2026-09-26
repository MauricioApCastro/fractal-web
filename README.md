# Fractal - Planejador Visual (PWA)

Organizador visual em círculos para projetos, tarefas, notas e ideias, com anexos.
(imagens, vídeos, links e arquivos).

Acesse: **https://mauricioapcastro.github.io/fractal-web/**

## Como usar

- **Instalar**: no navegador (desktop ou celular), use "Adicionar à tela inicial"
  / "Instalar aplicativo". Funciona offline.
- **Projetos**: ficam salvos no navegador (IndexedDB). Use **Importar**/**Exportar**
  para backup ou para levar para outro aparelho.
- **Navegação visual**: use a rodinha do mouse para aplicar zoom e arraste a área para navegar quando estiver ampliada.
- **Progresso**: abra o menu de um círculo para marcar ou reabrir um item como concluído.
- **Metas**: crie uma meta pelo menu do centro, informe a duração em dias e registre o progresso com os botões `−1` e `+1`.
- Os arquivos `.fractal` são compatíveis com o app de Windows (versão .NET MAUI).

## Publicar alterações

```sh
git add .
git commit -m "atualização"
git push
```
O GitHub Pages atualiza automaticamente em 1-2 minutos.

## Estrutura

- `index.html` / `css/` / `js/` — aplicativo
- `manifest.json` + `sw.js` — PWA (instalação e offline)
- `icons/` — ícones do app