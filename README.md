# GVS Events — organizador de materiais para eventos

Programa local para organizar **apresentações (PowerPoint/Keynote), PDFs, vídeos e cortes** de palestras, congressos, workshops e afins. Roda no seu computador (ou em um notebook da produção) e pode ser acessado por toda a equipe pela rede local, direto no navegador.

Pensado para o dia a dia de quem opera o evento: receber material dos palestrantes, conferir, aprovar, montar a pasta de cada sala, acompanhar o que ainda falta e, depois, gerar cortes das gravações para as redes.

## Principais recursos

- **Eventos, salas, palestrantes e programação** — importe a programação inteira colando um texto ou CSV; salas e palestrantes são criados automaticamente.
- **Materiais com fluxo de aprovação** — `Recebido → Em revisão → Aprovado → Final` (ou Rejeitado), versões com histórico, tags, observações, detecção de duplicatas (SHA-256) e lixeira por evento.
- **Metadados automáticos** — duração, resolução e codec de vídeos (ffprobe), número de slides (PPTX) e de páginas (PDF), miniaturas.
- **Prévia no navegador** — PDFs, imagens, áudio, vídeos MP4/WebM; apresentações viram PDF automaticamente (LibreOffice) e podem ser salvas como **backup em PDF**; vídeos em formatos pesados ganham uma **prévia MP4** leve.
- **Checklist por sessão** — modelo configurável (apresentação recebida, testada na sala, fontes conferidas, 16:9, backup em PDF…), com registro de quem concluiu cada item.
- **Mapa de prontidão** — visão geral por sala e dia do que está pronto, em andamento ou pendente; lista de pendências e atividade recente.
- **Programação em lista ou grade** por sala, com arrastar-e-soltar de arquivos direto na linha da sessão.
- **Cortes de vídeo** — marque início e fim na gravação (teclas `I`/`O`), escolha formato **vertical 9:16 (Reels/Shorts)**, quadrado 1:1 ou original, destinos (Instagram, YouTube, TikTok, LinkedIn…) e renderize com ffmpeg; o resultado vira um material do evento com seu próprio fluxo de aprovação.
- **Pasta do operador** — exporta os arquivos aprovados em `Dia N - data / Sala / NN - horário - palestrante - título / arquivo`, com `LEIA-ME.txt` e `programacao.csv`, pronta para copiar para o computador de cada sala.
- **Importar de pasta/pendrive** — escaneia uma pasta, sugere a sessão pelo nome do arquivo (palestrante ou título) e importa em lote, copiando ou movendo.
- **Downloads e relatórios** — ZIP por sessão ou do evento inteiro, CSV de programação, materiais e cortes.
- **Modo ao vivo** — tela para o operador de palco: relógio, "agora" e "a seguir" em cada sala, tempo restante, arquivos com um clique e alerta de checklist pendente; permite simular horário para ensaio.
- **Busca global** (`Ctrl+K`), histórico de atividade por usuário, tema escuro/claro, backups automáticos do índice.
- **Sem dependências externas**: só Node.js. ffmpeg, LibreOffice e poppler são opcionais e ampliam os recursos.

## Requisitos

- **Node.js 18.17 ou superior** (recomendado 20+).
- Opcionais, detectados automaticamente:
  - **ffmpeg / ffprobe** — metadados, miniaturas, prévias MP4 e renderização de cortes.
  - **LibreOffice** — conversão de PPT/PPTX/Keynote/ODP em PDF.
  - **poppler** (`pdftoppm`, `pdfinfo`) — miniaturas e contagem de páginas de PDF.

Instalação rápida dos opcionais:

```bash
# macOS (Homebrew)
brew install ffmpeg poppler && brew install --cask libreoffice

# Ubuntu/Debian
sudo apt install ffmpeg poppler-utils libreoffice-impress

# Windows: winget install Gyan.FFmpeg TheDocumentFoundation.LibreOffice
# (poppler para Windows: https://github.com/oschwartz10612/poppler-windows/releases, adicione a pasta bin ao PATH)
```

## Como usar

```bash
git clone https://github.com/thorthy/gvs-events.git
cd gvs-events
npm start
```

Abra `http://localhost:3210`. O terminal também mostra o endereço de rede (ex.: `http://192.168.0.10:3210`) para a equipe acessar de outros computadores.

Na primeira vez, informe seu nome: ele aparece no histórico e nos checklists.

### Opções do servidor

```bash
node bin/gvs-events.js serve --port 3210 --host 0.0.0.0 --library ./biblioteca --token SENHA
```

| Opção / variável | Padrão | Descrição |
| --- | --- | --- |
| `--port` / `GVS_PORT` | `3210` | Porta HTTP |
| `--host` / `GVS_HOST` | `0.0.0.0` | Interface (use `127.0.0.1` para acesso só local) |
| `--library` / `GVS_LIBRARY` | `./biblioteca` | Pasta onde ficam índice e arquivos (pode ser um HD externo ou pendrive) |
| `--token` / `GVS_TOKEN` | vazio | Exige um token de acesso para usar a interface e a API |
| `GVS_MAX_UPLOAD_GB` | `64` | Tamanho máximo por arquivo enviado |

### Linha de comando

```bash
node bin/gvs-events.js list                                  # lista eventos e prontidão
node bin/gvs-events.js scan <evento> <pasta> [--mover]       # importa arquivos de uma pasta
node bin/gvs-events.js export <evento> [--dest PASTA] [--todos] [--link]
node bin/gvs-events.js backup                                # copia o índice para biblioteca/backups
```

`<evento>` pode ser o id ou o slug (ex.: `congresso-alameda-2026`).

## Fluxo sugerido

1. **Crie o evento** e importe a programação (aba *Programação → Importar programação*). Exemplo de texto aceito:

   ```
   # 2026-03-10
   ## Sala A
   09:00-09:45 | Abertura oficial | Maria Silva | abertura
   09:45-10:30 | Inteligência artificial na prática | João Souza, Ana Lima
   10:30-11:00 | Coffee break
   ## Auditório
   11:00-12:00 | Painel: o futuro do setor | Carlos Melo; Beatriz Dias | painel
   ```

   Também aceita CSV com cabeçalho `data;inicio;fim;sala;titulo;palestrantes;tipo`.
2. **Receba os materiais**: arraste arquivos para a linha da sessão, use o painel da sessão ou importe uma pasta/pendrive. Apresentações ganham prévia em PDF automaticamente.
3. **Confira e aprove**: abra cada material, veja a prévia e os metadados, marque *Aprovado* ou *Final*, gere o backup em PDF e complete o checklist da sessão.
4. **Acompanhe** na *Visão geral* o mapa de prontidão por sala/dia e as pendências.
5. **Gere a pasta do operador** (*Exportar & ajustes*) e copie para o computador de cada sala. No dia, use o **Modo ao vivo**.
6. **Depois do evento**, envie as gravações, marque os melhores trechos na aba *Cortes* e renderize nos formatos de cada rede.

## Estrutura da biblioteca em disco

```
biblioteca/
  biblioteca.json            índice (eventos, sessões, materiais, cortes, histórico)
  backups/                   cópias do índice (automáticas a cada 24h e manuais)
  eventos/<slug-do-evento>/
    arquivos/                materiais atuais (id__nome-original.ext)
    versoes/                 versões anteriores
    derivados/               prévias geradas (PDF de apresentações, MP4 leve de vídeos)
    miniaturas/              thumbnails
    cortes/                  arquivos temporários de renderização
    exportacoes/             pastas do operador geradas
    lixeira/                 materiais excluídos (esvazie quando quiser)
  eventos-excluidos/         pastas de eventos apagados, para recuperação manual
```

A biblioteca é autocontida: copie a pasta inteira para outro computador e aponte `--library` para ela.

## API

Toda a interface usa uma API REST em `/api` (JSON). Alguns exemplos:

```bash
curl http://localhost:3210/api/events
curl -X POST http://localhost:3210/api/events -H 'Content-Type: application/json' -d '{"name":"Meu evento","startDate":"2026-05-10"}'
# upload (corpo bruto, sem multipart)
curl -X PUT "http://localhost:3210/api/events/<id>/assets?filename=slides.pptx&sessionId=<sessao>" --data-binary @slides.pptx
```

Envie o cabeçalho `X-User: nome` para registrar quem fez cada ação. Com `--token`, use `Authorization: Bearer <token>`.

## Desenvolvimento

```bash
npm run dev    # reinicia ao salvar arquivos
npm test       # testes unitários, de API e de integração (ffmpeg/LibreOffice quando disponíveis)
```

Backend em `src/` (Node.js puro, sem dependências), interface em `public/` (HTML/CSS/JS sem build).

## Licença

MIT.
