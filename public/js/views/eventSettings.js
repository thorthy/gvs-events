// Event settings tab: export, import from folder, event data, storage, danger zone.
import { h, icon, btn, badge, select, formModal, openModal, confirmDialog, toast, fmtBytes, fmtDate, copyText, EVENT_STATUS_LABELS, KIND_LABELS, downloadUrl, append, replace, clear } from '../dom.js';
import { api } from '../api.js';
import { state, loadEvents, refresh } from '../state.js';

export function renderEventSettings(container, { bundle }) {
  const { event } = bundle;
  append(container, 
    h('div', { class: 'grid-2' },
      exportCard(bundle),
      importCard(bundle),
      eventDataCard(bundle),
      storageCard(bundle),
    ),
    h('div', { class: 'danger-box mt-24' },
      h('h3', { class: 'mb-8', style: { color: 'var(--danger)' } }, 'Zona de perigo'),
      h('p', { class: 'muted small' }, 'Excluir o evento remove sessões, salas, palestrantes, cortes e o histórico. A pasta de arquivos é movida para "eventos-excluidos" dentro da biblioteca, para recuperação manual.'),
      btn('Excluir evento', { icon: 'trash', cls: 'btn-danger', onClick: async () => {
        if (await confirmDialog({ title: 'Excluir evento', message: `Excluir "${event.name}" com ${event.stats.sessions} sessões e ${event.stats.assets} materiais?`, confirmLabel: 'Excluir evento', danger: true })) {
          await api.delete(`/api/events/${event.id}`); toast('Evento excluído'); await loadEvents(); location.hash = '#/';
        } } })),
  );
}

function exportCard(bundle) {
  const { event } = bundle;
  const include = select([{ value: 'aprovados', label: 'Somente aprovados e finais' }, { value: 'todos', label: 'Todos (marca os não aprovados no nome)' }], 'aprovados');
  const mode = select([{ value: 'copiar', label: 'Copiar arquivos' }, { value: 'link', label: 'Hard link (rápido, mesmo disco)' }], 'copiar');
  const dest = h('input', { class: 'input', placeholder: 'Opcional: pasta de destino (ex.: D:\\Evento ou /Volumes/PENDRIVE/Evento)' });
  const previewBox = h('div');
  return h('div', { class: 'card' },
    h('div', { class: 'card-header' }, h('div', { class: 'card-title' }, icon('download'), 'Exportar')),
    h('p', { class: 'muted small' }, 'A pasta do operador organiza os arquivos em ', h('code', null, 'Dia / Sala / NN - horário - palestrante - título'), ', pronta para copiar para o computador de cada sala.'),
    h('div', { class: 'col gap-12 mt-16' },
      h('div', { class: 'form-grid' }, h('label', { class: 'field' }, 'Incluir', include), h('label', { class: 'field' }, 'Modo', mode), h('label', { class: 'field span-2' }, 'Destino', dest)),
      h('div', { class: 'flex flex-wrap' },
        btn('Gerar pasta do operador', { icon: 'folder', cls: 'btn-primary btn-sm', onClick: async () => {
          const job = await api.post(`/api/events/${event.id}/export/operator`, { include: include.value, mode: mode.value, dest: dest.value.trim() || undefined });
          toast('Exportação iniciada; acompanhe em "Processamentos"'); 
          watchJob(job.id, (j) => { if (j.status === 'concluido') openModal({ title: 'Pasta do operador gerada', body: h('div', { class: 'col' }, h('p', null, `${j.result.files} arquivo(s), ${fmtBytes(j.result.bytes)}.`), h('div', { class: 'flex' }, h('code', { class: 'grow', style: { wordBreak: 'break-all' } }, j.result.dest), btn('', { icon: 'copy', cls: 'btn-ghost btn-icon btn-sm', onClick: () => copyText(j.result.dest) }))), actions: [{ label: 'Fechar' }] }); });
        } }),
        btn('Pré-visualizar estrutura', { icon: 'list', cls: 'btn-sm', onClick: async () => {
          const entries = await api.get(`/api/events/${event.id}/export/operator/preview?include=${include.value}`);
          replace(previewBox, entries.length ? h('pre', { class: 'mono small', style: { background: 'var(--bg-3)', padding: '10px', borderRadius: '8px', maxHeight: '260px', overflow: 'auto', whiteSpace: 'pre-wrap' } }, entries.map((e) => `${e.path}  (${fmtBytes(e.size)})`).join('\n')) : h('p', { class: 'muted small' }, 'Nenhum arquivo elegível. Aprove materiais ou escolha "Todos".'));
        } })),
      previewBox,
      h('div', { class: 'section-title mt-8' }, 'Downloads'),
      h('div', { class: 'flex flex-wrap' },
        btn('ZIP dos aprovados', { icon: 'download', cls: 'btn-sm', onClick: () => downloadUrl(api.exportUrl(event.id, 'zip')) }),
        btn('ZIP de tudo', { icon: 'download', cls: 'btn-sm', onClick: () => downloadUrl(api.exportUrl(event.id, 'zip', '?include=todos')) }),
        btn('Programação (CSV)', { icon: 'calendar', cls: 'btn-sm', onClick: () => downloadUrl(api.exportUrl(event.id, 'programacao.csv')) }),
        btn('Materiais (CSV)', { icon: 'folder', cls: 'btn-sm', onClick: () => downloadUrl(api.exportUrl(event.id, 'materiais.csv')) }),
        btn('Cortes (CSV)', { icon: 'scissors', cls: 'btn-sm', onClick: () => downloadUrl(api.exportUrl(event.id, 'cortes.csv')) }),
        btn('Imprimir programação', { icon: 'external', cls: 'btn-sm', onClick: () => { location.hash = `#/eventos/${event.id}/programacao`; setTimeout(() => window.print(), 400); } }))),
  );
}

function watchJob(jobId, onDone) {
  const tick = async () => {
    const j = await api.get(`/api/jobs/${jobId}`).catch(() => null);
    if (!j) return;
    if (j.status === 'concluido' || j.status === 'erro') { onDone(j); refresh(); return; }
    setTimeout(tick, 1500);
  };
  setTimeout(tick, 1000);
}

function importCard(bundle) {
  const { event } = bundle;
  const pathInput = h('input', { class: 'input', placeholder: 'Caminho da pasta no computador do servidor (ex.: E:\\PENDRIVE ou /Volumes/PENDRIVE)' });
  const recursive = h('input', { type: 'checkbox', checked: true });
  const result = h('div');
  const scan = async () => {
    if (!pathInput.value.trim()) { toast('Informe o caminho da pasta', { type: 'warn' }); return; }
    replace(result, h('div', { class: 'muted small' }, h('span', { class: 'spinner' }), ' Lendo pasta…'));
    try {
      const res = await api.post(`/api/events/${event.id}/scan/preview`, { path: pathInput.value.trim(), recursive: recursive.checked });
      renderScanResult(res);
    } catch (err) { replace(result, h('div', { class: 'form-error' }, err.message)); }
  };
  const renderScanResult = (res) => {
    if (!res.files.length) { replace(result, h('p', { class: 'muted small' }, 'Nenhum arquivo suportado encontrado nessa pasta.')); return; }
    const sessionOptions = [{ value: '', label: '— sem sessão —' }, ...bundle.sessions.map((s) => ({ value: s.id, label: `${s.date ? s.date.slice(5) + ' ' : ''}${s.start ? s.start + ' ' : ''}${s.title}` }))];
    const rows = res.files.map((f) => {
      const cb = h('input', { type: 'checkbox', checked: !f.maybeDuplicate });
      const sel = select(sessionOptions, f.suggestion?.sessionId || '', { cls: 'select-sm' });
      return { f, cb, sel, tr: h('tr', null, h('td', null, cb), h('td', null, h('div', { class: 'ellipsis', style: { maxWidth: '260px' }, title: f.relative }, f.relative), f.maybeDuplicate ? h('div', { class: 'small', style: { color: 'var(--warn)' } }, `mesmo tamanho de "${f.maybeDuplicate}"`) : null), h('td', null, KIND_LABELS[f.kind]), h('td', { class: 'nowrap' }, fmtBytes(f.size)), h('td', null, sel, f.suggestion ? h('div', { class: 'small muted' }, 'sugestão automática') : null)) };
    });
    const modeSel = select([{ value: 'copiar', label: 'Copiar (mantém o original)' }, { value: 'mover', label: 'Mover (remove da pasta de origem)' }], 'copiar', { cls: 'select-sm input-inline' });
    replace(result, 
      h('div', { class: 'flex between mb-8 small' }, h('span', null, h('strong', null, res.files.length), ' arquivo(s) encontrados', res.truncated ? ' (lista truncada)' : ''), h('label', { class: 'checkbox small' }, h('input', { type: 'checkbox', checked: true, onChange: (e) => rows.forEach((r) => { r.cb.checked = e.target.checked; }) }), 'Selecionar todos')),
      h('div', { class: 'table-wrap', style: { maxHeight: '320px', overflow: 'auto' } }, h('table', { class: 'table scan-table' }, h('thead', null, h('tr', null, h('th'), h('th', null, 'Arquivo'), h('th', null, 'Tipo'), h('th', null, 'Tamanho'), h('th', null, 'Sessão'))), h('tbody', null, rows.map((r) => r.tr)))),
      h('div', { class: 'flex mt-8 flex-wrap' }, modeSel, btn('Importar selecionados', { icon: 'upload', cls: 'btn-primary btn-sm', onClick: async () => {
        const chosen = rows.filter((r) => r.cb.checked);
        if (!chosen.length) { toast('Selecione ao menos um arquivo', { type: 'warn' }); return; }
        const assignments = {};
        for (const r of chosen) if (r.sel.value) assignments[r.f.relative] = r.sel.value;
        await api.post(`/api/events/${event.id}/scan/import`, { path: res.root, files: chosen.map((r) => r.f.relative), assignments, mode: modeSel.value });
        toast(`Importando ${chosen.length} arquivo(s) em segundo plano`, { type: 'ok' });
        clear(result);
      } })));
  };
  return h('div', { class: 'card' },
    h('div', { class: 'card-header' }, h('div', { class: 'card-title' }, icon('folder'), 'Importar de uma pasta')),
    h('p', { class: 'muted small' }, 'Útil quando os materiais chegam por pendrive ou pasta compartilhada: o programa lista os arquivos, sugere a sessão pelo nome (palestrante/título) e importa em lote.'),
    h('div', { class: 'col gap-12 mt-16' },
      pathInput,
      h('div', { class: 'flex between' }, h('label', { class: 'checkbox small' }, recursive, 'Incluir subpastas'), btn('Escanear pasta', { icon: 'search', cls: 'btn-sm', onClick: scan })),
      result));
}

function eventDataCard(bundle) {
  const { event } = bundle;
  const template = h('textarea', { class: 'textarea mono', rows: 6, placeholder: state.system?.settings?.checklistTemplate?.join('\n') || '' }, (event.checklistTemplate || []).join('\n'));
  return h('div', { class: 'card' },
    h('div', { class: 'card-header' }, h('div', { class: 'card-title' }, icon('calendar'), 'Dados do evento'), btn('Editar', { icon: 'edit', cls: 'btn-sm', onClick: () => editEvent(event) })),
    h('div', { class: 'meta-grid' },
      h('div', null, h('div', { class: 'k' }, 'Nome'), h('div', { class: 'v' }, event.name)),
      h('div', null, h('div', { class: 'k' }, 'Datas'), h('div', { class: 'v' }, `${fmtDate(event.startDate)} – ${fmtDate(event.endDate)}`)),
      h('div', null, h('div', { class: 'k' }, 'Local'), h('div', { class: 'v' }, [event.venue, event.city].filter(Boolean).join(', ') || '—')),
      h('div', null, h('div', { class: 'k' }, 'Cliente'), h('div', { class: 'v' }, event.client || '—')),
      h('div', null, h('div', { class: 'k' }, 'Status'), h('div', { class: 'v' }, EVENT_STATUS_LABELS[event.status])),
      h('div', null, h('div', { class: 'k' }, 'Pasta (slug)'), h('div', { class: 'v mono small' }, event.slug))),
    event.description ? h('p', { class: 'muted mt-16' }, event.description) : null,
    h('div', { class: 'section-title mt-16' }, 'Checklist padrão deste evento'),
    h('p', { class: 'muted small' }, 'Um item por linha. Deixe vazio para usar o checklist global (Configurações). Aplicado a novas sessões; use "Aplicar a sessões existentes" para completar as já criadas.'),
    template,
    h('div', { class: 'flex flex-wrap mt-8' },
      btn('Salvar checklist', { icon: 'save', cls: 'btn-sm', onClick: async () => { const lines = template.value.split('\n').map((l) => l.trim()).filter(Boolean); await api.patch(`/api/events/${event.id}`, { checklistTemplate: lines.length ? lines : null }); toast('Checklist salvo', { type: 'ok' }); refresh(); } }),
      btn('Aplicar a sessões existentes', { icon: 'check', cls: 'btn-sm', onClick: async () => { const r = await api.post(`/api/events/${event.id}/checklist/apply`, { onlyEmpty: false }); toast(`Checklist aplicado a ${r.touched} sessões`, { type: 'ok' }); refresh(); } })),
  );
}

async function editEvent(event) {
  const r = await formModal({
    title: 'Editar evento',
    fields: [
      { name: 'name', label: 'Nome', required: true, value: event.name, span: 2 },
      { name: 'startDate', label: 'Data inicial', type: 'date', value: event.startDate },
      { name: 'endDate', label: 'Data final', type: 'date', value: event.endDate },
      { name: 'venue', label: 'Local', value: event.venue },
      { name: 'city', label: 'Cidade', value: event.city },
      { name: 'client', label: 'Cliente / organizador', value: event.client },
      { name: 'color', label: 'Cor', type: 'color', value: event.color },
      { name: 'status', label: 'Status', type: 'select', options: Object.entries(EVENT_STATUS_LABELS).map(([value, label]) => ({ value, label })), value: event.status },
      { name: 'description', label: 'Descrição', type: 'textarea', value: event.description, span: 2 },
    ],
    onSubmit: (v) => api.patch(`/api/events/${event.id}`, v),
  });
  if (r) { toast('Evento atualizado', { type: 'ok' }); await loadEvents(); refresh(); }
}

function storageCard(bundle) {
  const { event } = bundle;
  const box = h('div', { class: 'muted small' }, 'Calculando…');
  const load = () => api.get(`/api/events/${event.id}/storage`).then((s) => {
    replace(box, 
      h('div', { class: 'meta-grid' },
        h('div', null, h('div', { class: 'k' }, 'Arquivos atuais'), h('div', { class: 'v' }, fmtBytes(s.files))),
        h('div', null, h('div', { class: 'k' }, 'Versões antigas'), h('div', { class: 'v' }, fmtBytes(s.versions))),
        h('div', null, h('div', { class: 'k' }, 'Prévias (PDF/MP4)'), h('div', { class: 'v' }, fmtBytes(s.derived))),
        h('div', null, h('div', { class: 'k' }, 'Exportações'), h('div', { class: 'v' }, fmtBytes(s.exports))),
        h('div', null, h('div', { class: 'k' }, 'Lixeira'), h('div', { class: 'v' }, fmtBytes(s.trash)))),
      h('div', { class: 'flex mt-16' }, h('code', { class: 'grow ellipsis', title: s.path }, s.path), btn('', { icon: 'copy', cls: 'btn-ghost btn-icon btn-sm', title: 'Copiar caminho', onClick: () => copyText(s.path) })),
      h('div', { class: 'flex mt-8' }, btn('Esvaziar lixeira', { icon: 'trash', cls: 'btn-sm btn-danger', disabled: !s.trash, onClick: async () => { if (await confirmDialog({ title: 'Esvaziar lixeira', message: 'Apagar definitivamente os arquivos excluídos deste evento?', confirmLabel: 'Apagar', danger: true })) { const r = await api.delete(`/api/events/${event.id}/trash`); toast(`${r.removed} item(ns) apagados`, { type: 'ok' }); load(); } } })),
    );
  }).catch(() => { box.textContent = 'Não foi possível calcular.'; });
  load();
  return h('div', { class: 'card' }, h('div', { class: 'card-header' }, h('div', { class: 'card-title' }, icon('layers'), 'Armazenamento')), box);
}
