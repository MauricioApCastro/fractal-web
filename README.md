# Fractal — versão web (endereço antigo)

O Fractal é um organizador visual em círculos para projetos, tarefas, notas e
ideias, com fluxogramas, metas, compromissos, anexos e sincronização opcional
pelo Google Drive do próprio usuário. Desenvolvido pela **Mactecnology**.

- Endereço oficial da versão web: **https://mactecnology.com.br/fractal/**.
  Só abre para contas Google que já usaram o app Android.
- Este repositório publica o **endereço antigo**,
  https://mauricioapcastro.github.io/fractal-web/. Ele continua funcionando e
  mostra um aviso do endereço novo.
- Aplicativo Android: `com.mactecnology.fractal` (Google Play).
- Política de privacidade: https://mactecnology.com.br/fractal/privacidade.html

## Não edite aqui

Os arquivos deste repositório são **gerados**. A fonte fica no repositório
`fractal`, em `Fractal/Resources/Raw/web`, e é publicada nos dois endereços
pelo script `publicar-site.ps1`, que também sobe a versão do cache:

```powershell
cd C:\FractalRepo\fractal
.\publicar-site.ps1
```

Alterações feitas direto aqui são apagadas na próxima publicação. Só este
README, o `.nojekyll` e o `CNAME` (se existir) são preservados.

## Estrutura

- `index.html`, `css/`, `js/`: o aplicativo
- `manifest.json` e `sw.js`: instalação como app e uso offline
- `icons/`: ícones
- `privacidade.html`: política de privacidade
