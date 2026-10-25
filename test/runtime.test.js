'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const client = require('../nodes/client');
const register = require('../nodes/nova');
let server, baseUrl, handler, calls;
before(async () => {
    server = http.createServer(async (req, res) => {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        calls.push({ method: req.method, path: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
        handler(req, res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
});
after(() => { server.closeAllConnections(); server.close(); });
function setup(fn) {
    calls = []; handler = fn || ((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end('{"data":[]}'); });
    return { credentials: { apiKey: 'secret-never-log' }, baseUrl, timeout: 1, configId: 'connection-route', pending: new Set() };
}
function json(data, status = 200) { return (req, res) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); }; }
test('all eleven endpoints send correct requests and simplify complete responses', async t => {
    const cases = [
        ['chat', 'Hello', { choices: [{ message: { content: 'Hi!' } }] }, 'Hi!', '/chat/completions'],
        ['response', 'Hello', { output: [{ content: [{ type: 'output_text', text: 'Hi' }, { type: 'output_text', text: '!' }] }] }, 'Hi!', '/responses'],
        ['embeddings', ['a', 'b'], { data: [{ embedding: [1, 2] }, { embedding: [3, 4] }] }, [[1, 2], [3, 4]], '/embeddings'],
        ['image', 'A canal', { data: [{ url: 'https://example.org/image.png' }] }, [{ url: 'https://example.org/image.png' }], '/images/generations'],
        ['transcription', Buffer.from('wav'), { text: 'Hello' }, 'Hello', '/audio/transcriptions'],
        ['translation', Buffer.from('wav'), { text: 'Hello' }, 'Hello', '/audio/translations'],
        ['speakers', Buffer.from('wav'), { segments: [{ speaker: '1', start: 0, end: 1 }] }, [{ speaker: '1', start: 0, end: 1 }], '/audio/diarization'],
        ['models', null, { data: [{ id: 'm' }], has_more: true, last_id: 'm' }, [{ id: 'm' }], '/models'],
        ['providers', null, { data: [{ id: 'p' }] }, [{ id: 'p' }], '/providers'],
        ['voices', null, { voices: ['v'] }, ['v'], '/audio/voices?model=m']
    ];
    for (const [kind, payload, response, expected, path] of cases) await t.test(kind, async () => {
        const connection = setup(json(response));
        const { path: actualPath, ...options } = client.prepare(kind, { model: 'm' }, { payload });
        assert.equal(actualPath, path);
        const result = await client.request(connection, actualPath, options);
        assert.deepEqual(result.response, response);
        assert.deepEqual(client.output(kind, result.response), expected);
        assert.equal(result.status, 200);
        assert.equal(result.contentType, 'application/json');
        assert.equal(calls[0].headers.authorization, 'Bearer secret-never-log');
        assert.equal(calls[0].headers['x-config-id'], 'connection-route');
        if (options.body instanceof FormData) {
            assert.match(calls[0].headers['content-type'], /^multipart\/form-data; boundary=/);
            assert.match(calls[0].body, /filename="audio.wav"/);
            assert.match(calls[0].body, /wav/);
        }
        assert.equal(connection.pending.size, 0);
    });
    const connection = setup((req, res) => { res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(Buffer.from([0, 1, 2, 255])); });
    const { path, ...options } = client.prepare('speech', { model: 'tts', voice: 'voice-a', response_format: 'wav' }, { payload: 'hello' });
    const result = await client.request(connection, path, options);
    assert.equal(path, '/audio/speech'); assert.deepEqual(result.response, Buffer.from([0, 1, 2, 255]));
    assert.equal(JSON.parse(calls[0].body).voice, 'voice-a');
});
test('payload and routing overrides take precedence; defaults stay unset', () => {
    const result = client.prepare('chat', { model: 'old', temperature: '' }, { payload: 'ignored', nova: { request: { model: 'new', messages: [{ role: 'user', content: 'override' }], temperature: 0 }, configId: 'override-route' } });
    assert.equal(result.body.model, 'new'); assert.equal(result.body.temperature, 0); assert.equal(result.configId, 'override-route');
    assert.equal(result.body.messages[0].content, 'override');
    assert.deepEqual(client.prepare('speech', { model: 'm', voice: '', response_format: '' }, { payload: 'text' }).body, { model: 'm', input: 'text' });
    assert.equal(client.prepare('models', { operation: 'retrieve', model: 'a/b' }, {}).path, '/models/a%2Fb');
    assert.equal(client.prepare('models', { limit: '10', after: 'a b' }, {}).path, '/models?limit=10&after=a+b');
    assert.equal(client.prepare('image', { model: 'm', imageCount: '2' }, { payload: 'canal' }).body.n, 2);
});
test('text and subtitle audio formats, filename, mimetype, and extra multipart options', async () => {
    const connection = setup((req, res) => { res.writeHead(200, { 'Content-Type': 'text/vtt' }); res.end('WEBVTT\n'); });
    const { path, ...options } = client.prepare('transcription', { model: 'm', language: 'nl' }, { payload: Buffer.from('audio'), filename: 'C:\\recordings\\speech.mp3', mimetype: 'audio/mpeg', nova: { request: { response_format: 'vtt', timestamp_granularities: ['word'] } } });
    const result = await client.request(connection, path, options);
    assert.equal(client.output('transcription', result.response), 'WEBVTT\n');
    assert.match(calls[0].body, /filename="speech.mp3"/); assert.match(calls[0].body, /Content-Type: audio\/mpeg/); assert.match(calls[0].body, /\["word"\]/);
});
test('tool-only chat and structured Responses keep their distinct empty values', () => {
    assert.equal(client.output('chat', { choices: [{ message: { tool_calls: [{ id: 'call' }] } }] }), null);
    assert.equal(client.output('response', { output: [{ type: 'function_call' }] }), '');
});
test('invalid input, missing model, file paths, streaming and malformed responses fail clearly', () => {
    for (const [kind, payload] of [['chat', {}], ['response', 42], ['embeddings', [1]], ['speech', ''], ['image', null], ['transcription', '/audio.wav'], ['translation', null], ['speakers', {}]]) {
        assert.throws(() => client.prepare(kind, { model: 'm' }, { payload }));
    }
    assert.throws(() => client.prepare('chat', {}, { payload: 'hi' }), /Choose a model/);
    assert.throws(() => client.prepare('chat', { model: 'm' }, { payload: 'hi', nova: { request: { stream: true } } }), /Streaming/);
    assert.throws(() => client.prepare('chat', { model: 'm' }, { payload: 'hi', nova: { request: [] } }), /object/);
    for (const kind of Object.keys(client.paths).filter(v => v !== 'speech')) assert.throws(() => client.output(kind, {}), /unexpected response/);
});
test('credentials, HTTP failures, JSON corruption and unexpected content types', async () => {
    const connection = setup(); connection.credentials = {};
    await assert.rejects(client.request(connection, '/models'), /Add an API key/); assert.equal(calls.length, 0);
    connection.credentials.apiKey = 'secret';
    for (const status of [401, 403, 429, 500]) {
        handler = json({ error: { message: 'secret server diagnostic' } }, status);
        await assert.rejects(client.request(connection, '/models'), error => error.status === status && !error.message.includes('secret'));
    }
    handler = (req, res) => { res.setHeader('Content-Type', 'application/json'); res.end('{'); };
    await assert.rejects(client.request(connection, '/models'), /invalid JSON/);
    handler = (req, res) => { res.end('<html>'); };
    await assert.rejects(client.request(connection, '/models'), /content type/);
    await assert.rejects(client.request(connection, '/speech', { binary: true }), /did not return audio/);
});
test('timeout and cancellation abort requests without retrying', async () => {
    const connection = setup(() => {}); connection.timeout = 0.03;
    await assert.rejects(client.request(connection, '/models'), /timed out/); assert.equal(calls.length, 1); assert.equal(connection.pending.size, 0);
    connection.timeout = 2;
    const promise = client.request(connection, '/models');
    for (const controller of connection.pending) controller.abort();
    await assert.rejects(promise, /cancelled/); assert.equal(connection.pending.size, 0);
});
test('speech validation errors explain the next action and redact credentials', async () => {
    const connection = setup(json({ error: { message: 'voice is required' } }, 400));
    await assert.rejects(client.request(connection, '/audio/speech', { body: { model: 'kokoro', input: 'Hello' }, binary: true }), error => error.status === 400 && /voice is required/.test(error.message) && /Voices example/.test(error.message));
    handler = json({ detail: [{ loc: ['body', 'voice'], msg: 'Field required', input: 'private input must not be echoed' }] }, 422);
    await assert.rejects(client.request(connection, '/audio/speech', { body: { input: 'Hello' } }), error => /body.voice: Field required/.test(error.message) && !error.message.includes('private input'));
    handler = json({ error: { message: 'Invalid secret-never-log; Authorization: Bearer another-private-token' } }, 400);
    await assert.rejects(client.request(connection, '/audio/speech', { body: { input: 'Hello' } }), error => !error.message.includes('secret-never-log') && !error.message.includes('another-private-token') && error.message.includes('[redacted]'));
    handler = (req, res) => { res.writeHead(400, { 'Content-Type': 'text/html' }); res.end('<html>private upstream diagnostic</html>'); };
    await assert.rejects(client.request(connection, '/audio/speech', { body: { input: 'Hello' } }), error => /Check Voice/.test(error.message) && !error.message.includes('private upstream'));
});
test('editor discovery collects all pages and guards repeated cursors', async () => {
    const connection = setup((req, res) => json(req.url.includes('after=') ? { data: [{ id: 'b' }], has_more: false } : { data: [{ id: 'a' }], has_more: true, last_id: 'a' })(req, res));
    assert.deepEqual(await client.allModels(connection), [{ id: 'a' }, { id: 'b' }]); assert.equal(calls.length, 2);
    handler = json({ data: [{ id: 'a' }], has_more: true, last_id: 'a' });
    await assert.rejects(client.allModels(connection), /repeated pagination/);
});
function harness() {
    const types = {}, instances = {}, routes = [], permissions = [];
    const RED = {
        nodes: {
            createNode(node, config) { Object.setPrototypeOf(node, EventEmitter.prototype); EventEmitter.call(node); node.id = config.id; node.type = config.type; node.credentials = config.credentials; node.status = () => {}; node.error = () => {}; instances[config.id] = node; },
            registerType(name, ctor, options) { types[name] = { ctor, options }; }, getNode(id) { return instances[id]; }
        }, httpAdmin: { get(...args) { routes.push(args); } }, auth: { needsPermission(p) { permissions.push(p); return () => {}; } }
    };
    register(RED);
    const make = (type, config) => new types[type].ctor({ ...config, type });
    return { types, instances, routes, permissions, make };
}
test('runtime preserves messages/full response and reports input failures to Catch', async () => {
    setup(json({ choices: [{ message: { content: 'Welcome' } }], usage: { total_tokens: 5 } }));
    const h = harness(); h.make('nova-connection', { id: 'c', baseUrl, credentials: { apiKey: 'secret' } });
    const node = h.make('nova-chat', { id: 'n', connection: 'c', model: 'm' });
    const msg = { payload: 'Hi', topic: 'keep', nova: { trace: 'keep' } };
    let sent;
    await new Promise((resolve, reject) => node.emit('input', msg, result => { sent = result; }, error => error ? reject(error) : resolve()));
    assert.equal(sent, msg); assert.equal(sent.payload, 'Welcome'); assert.equal(sent.topic, 'keep'); assert.equal(sent.nova.trace, 'keep'); assert.equal(sent.nova.response.usage.total_tokens, 5);
    const failure = await new Promise(resolve => node.emit('input', { payload: {} }, () => assert.fail('must not send'), resolve));
    assert.match(failure.message, /Provide text/);
});
test('admin routes require read permission and never disclose credentials', async () => {
    setup(json({ data: [{ id: 'm', name: 'Model' }] }));
    const h = harness(); h.make('nova-connection', { id: 'c', baseUrl, credentials: { apiKey: 'secret-never-log' } });
    assert.deepEqual(h.types['nova-connection'].options.credentials, { apiKey: { type: 'password' } });
    assert.deepEqual(h.permissions, ['nova-connection.read', 'nova-connection.read']);
    for (const [, , route] of h.routes) {
        let result, code = 200, cache;
        const res = { set(k, v) { cache = v; }, status(n) { code = n; return this; }, json(data) { result = data; } };
        await route({ params: { id: 'c' } }, res);
        assert.equal(code, 200); assert.equal(cache, 'no-store'); assert.ok(!JSON.stringify(result).includes('secret'));
        await route({ params: { id: 'missing' } }, res); assert.equal(code, 404);
    }
    assert.ok(calls.some(call => call.path === '/v1/models?limit=1'));
});
test('closing runtime nodes and connections cancels outstanding requests', async () => {
    setup(() => {});
    const h = harness(); const connection = h.make('nova-connection', { id: 'c', baseUrl, credentials: { apiKey: 'secret' } });
    const node = h.make('nova-chat', { id: 'n', connection: 'c', model: 'm' });
    let sent = false;
    const done = new Promise(resolve => node.emit('input', { payload: 'hi' }, () => { sent = true; }, resolve));
    node.emit('close'); assert.match((await done).message, /cancelled/); assert.equal(sent, false); assert.equal(connection.pending.size, 0);
    const second = h.make('nova-chat', { id: 'n2', connection: 'c', model: 'm' });
    const done2 = new Promise(resolve => second.emit('input', { payload: 'hi' }, () => {}, resolve));
    connection.emit('close'); assert.match((await done2).message, /cancelled/);
});
