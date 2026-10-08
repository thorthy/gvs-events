import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProgram } from '../src/program.js';

test('parse linhas posicionais com marcadores de data e sala', () => {
  const text = `
# 10/03/2026
## Sala A
09:00-09:45 | Abertura oficial | Maria Silva | abertura
09:45 - 10:30 | Inteligência artificial na prática | João Souza, Ana Lima
10:30-11:00 | Coffee break
## Auditório
11:00 às 12:00 | Painel: o futuro do setor | Carlos Melo; Beatriz Dias | painel
`;
  const { rows, errors } = parseProgram(text);
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { line: 4, date: '2026-03-10', start: '09:00', end: '09:45', room: 'Sala A', title: 'Abertura oficial', speakers: ['Maria Silva'], type: 'abertura', description: '' });
  assert.deepEqual(rows[1].speakers, ['João Souza', 'Ana Lima']);
  assert.equal(rows[1].type, 'palestra');
  assert.equal(rows[2].type, 'intervalo');
  assert.equal(rows[2].speakers.length, 0);
  assert.equal(rows[3].room, 'Auditório');
  assert.equal(rows[3].type, 'painel');
  assert.deepEqual(rows[3].speakers, ['Carlos Melo', 'Beatriz Dias']);
});

test('parse CSV com cabeçalho', () => {
  const text = `data;inicio;fim;sala;titulo;palestrantes;tipo
2026-03-10;14:00;15:00;Sala B;Workshop de vendas;Pedro Rocha;workshop
2026-03-11;09:00;;Sala B;Encerramento;;
`;
  const { rows, errors } = parseProgram(text);
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].room, 'Sala B');
  assert.equal(rows[0].type, 'workshop');
  assert.equal(rows[1].type, 'encerramento');
  assert.equal(rows[1].end, '');
});

test('linhas inválidas geram erros sem derrubar as demais', () => {
  const { rows, errors } = parseProgram('# data-ruim\n09:00-09:30 | Título ok\n|||\n', { defaultDate: '2026-01-01' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, '2026-01-01');
  assert.equal(errors.length, 2);
});

test('sala inline com prefixo reconhecido e sem horário', () => {
  const { rows } = parseProgram('Palco principal | Show de encerramento | Banda X');
  assert.equal(rows[0].room, 'Palco principal');
  assert.equal(rows[0].title, 'Show de encerramento');
  assert.deepEqual(rows[0].speakers, ['Banda X']);
});
