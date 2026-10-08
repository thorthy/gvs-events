// Global settings: library, tools, backups, user.
import { h, icon, btn, badge, toast, fmtBytes, fmtDateTime, copyText, promptDialog, append, replace, clear } from '../dom.js';
import { api } from '../api.js';
import { state, loadSystem } from '../state.js';

export function renderSettings(container) {
  const sys = state.system || {};
  const s = sys.settings || {};
  const tools = sys.tools || {};
  const name = h('input', { class: 'input', value: s.name || '' });
  const destinations = h('input', { class: 'input', value: (s.destinations || []).join(', ') });
  const template = h('textarea', { class: 'textarea mono', rows: 7 }, (s.checklistTemplate || []).join('\n'));
  const autoPdf = h('input', { type: 'checkbox', checked: s.autoConvertPdf });
  const autoThumbs = h('input', { type: 'checkbox', checked: s.autoThumbnails });
  const toolRow = (label, ok, hint) => h('div', { class: 'list-item' }, badge(ok ? 'ok' : 'ausente', ok ? 'ok' : 'danger'), h('div', { class: 'body' }, h('div', { class: 'title' }, label), h('div', { class: 'sub' }, hint)));
  const backups = h('div', { class: 'muted small' }, 'Carregando…');
  const loadBackups = () => api.get('/api/backups').then((list) => {
    replace(backups, list.length ? h('div', { class: 'col gap-4' }, list.slice(0, 8).map((b) => h('div', { class: 'version-row' }, h('span', { class: 'grow mono small ellipsis' }, b.name), h('span', { class: 'muted' }, `${fmtBytes(b.size)} · ${fmtDateTime(b.mtime)}`)))) : h('p', { class: 'muted small' }, 'Nenhum backup ainda.'));
    backups.className = '';
  });
  loadBackups();

  append(container, 
    h('div', { class: 'page-header' }, h('div', { class: 'titles' }, h('h1', null, 'Configurações'), h('div', { class: 'sub' }, 'Preferências da biblioteca e informações do servidor'))),
    h('div', { class: 'grid-2' },
      h('div', { class: 'card' },
        h('div', { class: 'card-header' }, h('div', { class: 'card-title' }, icon('settings'), 'Biblioteca')),
        h('div', { class: 'col gap-12' },
          h('label', { class: 'field' }, 'Nome da biblioteca', name),
          h('label', { class: 'field' }, 'Destinos de cortes (separados por vírgula)', destinations),
          h('label', { class: 'field' }, 'Checklist padrão por sessão (um item por linha)', template),
          h('label', { class: 'checkbox' }, autoPdf, 'Gerar prévia em PDF automaticamente para apresentações (requer LibreOffice)'),
          h('label', { class: 'checkbox' }, autoThumbs, 'Gerar miniaturas automaticamente (requer ffmpeg / poppler)'),
          h('div', null, btn('Salvar', { icon: 'save', cls: 'btn-primary', onClick: async () => {
            await api.patch('/api/settings', { name: name.value, destinations: destinations.value, checklistTemplate: template.value.split('\n').map((l) => l.trim()).filter(Boolean), autoConvertPdf: autoPdf.checked, autoThumbnails: autoThumbs.checked });
            await loadSystem(); toast('Configurações salvas', { type: 'ok' });
          } })))),
      h('div', { class: 'col gap-16' },
        h('div', { class: 'card' },
          h('div', { class: 'card-header' }, h('div', { class: 'card-title' }, icon('zap'), 'Ferramentas no servidor')),
          h('div', { class: 'list' },
            toolRow('ffmpeg / ffprobe', tools.ffmpeg && tools.ffprobe, 'Metadados de vídeo, miniaturas, prévias MP4 e renderização de cortes'),
            toolRow('LibreOffice', tools.libreoffice, 'Converte PowerPoint/Keynote/ODP em PDF para prévia e backup'),
            toolRow('Poppler (pdftoppm/pdfinfo)', tools.pdftoppm, 'Miniaturas e contagem de páginas de PDFs')),
          h('p', { class: 'muted small mt-8' }, 'Instale o que faltar e reinicie o servidor. Sem as ferramentas o programa continua funcionando, apenas sem esses recursos.')),
        h('div', { class: 'card' },
          h('div', { class: 'card-header' }, h('div', { class: 'card-title' }, icon('info'), 'Servidor')),
          h('div', { class: 'meta-grid' },
            h('div', null, h('div', { class: 'k' }, 'Versão'), h('div', { class: 'v' }, `GVS Events ${sys.version || ''} · Node ${sys.node || ''}`)),
            h('div', null, h('div', { class: 'k' }, 'Biblioteca em disco'), h('div', { class: 'v mono small', style: { cursor: 'pointer' }, onClick: () => copyText(sys.libraryPath), title: 'Clique para copiar' }, sys.libraryPath))),
          h('div', { class: 'section-title mt-16' }, 'Acesso pela rede local'),
          h('p', { class: 'muted small' }, 'Outras pessoas da equipe (na mesma rede Wi-Fi/cabo) podem abrir o programa pelos endereços abaixo. Para proteger com senha, inicie o servidor com --token.'),
          h('div', { class: 'col gap-4' }, (sys.addresses || []).map((a) => h('div', { class: 'flex' }, h('code', { class: 'grow' }, `http://${a.address}:${location.port || 80}`), h('span', { class: 'muted small' }, a.name), btn('', { icon: 'copy', cls: 'btn-ghost btn-icon btn-sm', onClick: () => copyText(`http://${a.address}:${location.port || 80}`) }))))),
        h('div', { class: 'card' },
          h('div', { class: 'card-header' }, h('div', { class: 'card-title' }, icon('save'), 'Backups da biblioteca'), btn('Criar backup agora', { icon: 'plus', cls: 'btn-sm', onClick: async () => { const b = await api.post('/api/backups'); toast(`Backup criado: ${b.file}`, { type: 'ok' }); loadBackups(); } })),
          h('p', { class: 'muted small' }, 'O índice (biblioteca.json) é copiado automaticamente a cada 24h ao iniciar o servidor. Os arquivos ficam na pasta da biblioteca; faça backup dela com sua rotina habitual.'),
          backups),
        h('div', { class: 'card' },
          h('div', { class: 'card-header' }, h('div', { class: 'card-title' }, icon('users'), 'Você')),
          h('div', { class: 'flex' }, h('span', { class: 'grow' }, 'Nome usado no histórico: ', h('strong', null, state.user || '—')), btn('Trocar', { icon: 'edit', cls: 'btn-sm', onClick: async () => { const n = await promptDialog({ title: 'Seu nome', label: 'Nome', value: state.user }); if (n && n.trim()) { api.store.user = n.trim(); location.reload(); } } })),
          api.store.token ? h('div', { class: 'flex mt-8' }, h('span', { class: 'grow' }, 'Token de acesso salvo neste navegador'), btn('Esquecer', { cls: 'btn-sm', onClick: () => { api.store.token = ''; location.reload(); } })) : null),
        h('div', { class: 'card' },
          h('div', { class: 'card-header' }, h('div', { class: 'card-title' }, icon('zap'), 'Atalhos de teclado')),
          h('div', { class: 'shortcut-list' },
            h('span', null, h('kbd', null, 'Ctrl'), ' ', h('kbd', null, 'K')), h('span', null, 'Busca global'),
            h('span', null, h('kbd', null, 'Esc')), h('span', null, 'Fechar painel ou janela'),
            h('span', null, h('kbd', null, 'I'), ' / ', h('kbd', null, 'O')), h('span', null, 'No editor de cortes: marcar início / fim'),
            h('span', null, h('kbd', null, 'P')), h('span', null, 'No editor de cortes: tocar o trecho marcado'))))),
  );
}
