const test = require('node:test');
const assert = require('node:assert');
const { classifyJoinResponse } = require('../src/classify.js');

const queueFull = JSON.stringify([
  {
    data: null,
    errors: [
      {
        message: 'This task queue is full. Try again later.',
        locations: [{ line: 2, column: 3 }],
        path: ['joinTaskQueue'],
        extensions: { service_exception_code: 'RESOURCE_EXHAUSTED' }
      }
    ]
  }
]);

test('detects the queue-full error from the real payload', () => {
  assert.deepStrictEqual(classifyJoinResponse(queueFull), {
    status: 'full',
    message: 'This task queue is full. Try again later.'
  });
});

test('detects the queue-full error when the body is not batched', () => {
  const single = JSON.stringify(JSON.parse(queueFull)[0]);
  assert.strictEqual(classifyJoinResponse(single).status, 'full');
});

test('falls back to the message when the exception code is missing', () => {
  const body = JSON.stringify({
    errors: [{ message: 'This task queue is full.', path: ['joinTaskQueue'] }]
  });
  assert.strictEqual(classifyJoinResponse(body).status, 'full');
});

test('reports a successful join', () => {
  const body = JSON.stringify({ data: { joinTaskQueue: { id: 'abc' } } });
  assert.deepStrictEqual(classifyJoinResponse(body), { status: 'joined' });
});

test('reports any other joinTaskQueue error', () => {
  const body = JSON.stringify({
    data: null,
    errors: [
      {
        message: 'Not authorised.',
        path: ['joinTaskQueue'],
        extensions: { service_exception_code: 'PERMISSION_DENIED' }
      }
    ]
  });
  assert.deepStrictEqual(classifyJoinResponse(body), {
    status: 'error',
    message: 'Not authorised.'
  });
});

test('ignores responses for other operations', () => {
  const body = JSON.stringify({
    data: { currentUser: { id: '1' } },
    errors: [{ message: 'Something else broke.', path: ['otherThing'] }]
  });
  assert.strictEqual(classifyJoinResponse(body), null);
});

test('ignores a batch where only a sibling operation failed', () => {
  const body = JSON.stringify([
    { data: { joinTaskQueue: { id: 'abc' } } },
    { data: null, errors: [{ message: 'Unrelated.', path: ['somethingElse'] }] }
  ]);
  assert.deepStrictEqual(classifyJoinResponse(body), { status: 'joined' });
});

test('ignores non-JSON and unrelated input', () => {
  assert.strictEqual(classifyJoinResponse('joinTaskQueue but not json'), null);
  assert.strictEqual(classifyJoinResponse('{}'), null);
  assert.strictEqual(classifyJoinResponse(undefined), null);
});
