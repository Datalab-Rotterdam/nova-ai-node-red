'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const helper = require('node-red-node-test-helper');
const register = require('../nodes/nova');
const { paths } = require('../nodes/client');
helper.init(require.resolve('node-red'));
const core = ['common/20-inject.js', 'common/25-catch.js', 'common/90-comment.js', 'storage/10-file.js'].map(file => require('@node-red/nodes/core/' + file));
const cases = {
    '/v1/chat/completions': [{ choices: [{ message: { content: 'Hello' } }] }, 'Hello'],
    '/v1/responses': [{ output: [{ content: [{ type: 'output_text', text: 'A simple explanation.' }] }] }, 'A simple explanation.'],
    '/v1/embeddings': [{ data: [{ embedding: [1, 2] }, { embedding: [3, 4] }] }, [[1, 2], [3, 4]]],
    '/v1/images/generations': [{ data: [{ url: 'https://example.org/canal.png' }] }, [{ url: 'https://example.org/canal.png' }]],
    '/v1/audio/transcriptions': [{ text: 'Transcript' }, 'Transcript'],
    '/v1/audio/translations': [{ text: 'Translation' }, 'Translation'],
    '/v1/audio/diarization': [{ segments: [{ speaker: 'A', start: 0, end: 2 }] }, [{ speaker: 'A', start: 0, end: 2 }]],
    '/v1/audio/speech': [Buffer.from('RIFF mock speech'), Buffer.from('RIFF mock speech')],
    '/v1/models': [{ data: [{ id: 'friendly-model' }], has_more: true, last_id: 'friendly-model' }, [{ id: 'friendly-model' }]],
    '/v1/models/friendly-model': [{ id: 'friendly-model', name: 'Friendly model' }, { id: 'friendly-model', name: 'Friendly model' }],
    '/v1/providers': [{ data: [{ id: 'provider' }] }, [{ id: 'provider' }]],
    '/v1/audio/voices': [{ voices: ['preset'] }, ['preset']]
};
let server, baseUrl, fixtureDir, recording, calls = [];
before(async () => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-examples-'));
    recording = path.join(fixtureDir, 'recording.wav'); fs.writeFileSync(recording, 'RIFF audio fixture');
    server = http.createServer(async (req, res) => {
        const parts = []; for await (const part of req) parts.push(part);
        const url = new URL(req.url, 'http://localhost');
        calls.push({ url, body: Buffer.concat(parts).toString(), headers: req.headers });
        const response = cases[url.pathname]?.[0];
        if (!response) { res.writeHead(404); res.end(); return; }
        res.setHeader('Content-Type', Buffer.isBuffer(response) ? 'audio/wav' : 'application/json');
        res.end(Buffer.isBuffer(response) ? response : JSON.stringify(response));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
    await new Promise(resolve => helper.startServer(resolve));
});
after(async () => {
    await helper.unload(); await new Promise(resolve => helper.stopServer(resolve));
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.unlinkSync(recording); fs.rmdirSync(fixtureDir);
});
test('every operation has an example; all twelve complete flows run from Inject without Function nodes', async t => {
    const filenames = fs.readdirSync('examples').filter(name => name.endsWith('.json')).sort();
    assert.equal(filenames.length, 12);
    const covered = new Set(), operations = new Set();
    for (const filename of filenames) await t.test(filename, async () => {
        calls = [];
        const flow = JSON.parse(fs.readFileSync(path.join('examples', filename), 'utf8'));
        assert.ok(!flow.some(node => node.type === 'function'));
        assert.ok(!JSON.stringify(flow).includes('apiKey'));
        const connection = flow.find(node => node.type === 'nova-connection'); connection.baseUrl = baseUrl;
        const nova = flow.find(node => node.type.startsWith('nova-') && node.type !== 'nova-connection');
        covered.add(nova.type.slice(5));
        if (nova.type === 'nova-models') operations.add(nova.operation);
        if (nova.type !== 'nova-providers') nova.model = 'friendly-model';
        const inject = flow.find(node => node.type === 'inject'); assert.equal(inject.once, false); assert.ok(!inject.repeat);
        const file = flow.find(node => node.type === 'file in'); if (file) { assert.equal(file.format, ''); assert.equal(file.chunk, false); file.filename = recording; }
        const outputId = nova.wires[0][0];
        for (const node of flow.filter(node => node.type === 'debug')) node.type = 'helper';
        await helper.load([register, ...core], flow, { [connection.id]: { apiKey: 'mock-example-key' } });
        let timer;
        try {
            const result = await new Promise((resolve, reject) => {
                timer = setTimeout(() => reject(new Error('Example did not produce output: ' + filename)), 3000);
                helper.getNode(outputId).once('input', resolve);
                const errors = flow.find(node => node.type === 'catch');
                helper.getNode(errors.wires[0][0]).once('input', msg => reject(new Error(msg.error?.message || 'Example error')));
                helper.getNode(inject.id).receive({});
            });
            assert.equal(calls.length, 1);
            const call = calls[0], fixture = cases[call.url.pathname];
            assert.deepEqual(result.payload, fixture[1]); assert.deepEqual(result.nova.response, fixture[0]);
            assert.equal(result.nova.status, 200); assert.equal(call.headers.authorization, 'Bearer mock-example-key');
            if (file) assert.match(call.body, /RIFF audio fixture/);
            if (nova.type === 'nova-embeddings') assert.equal(JSON.parse(call.body).input.length, 2);
            if (nova.type === 'nova-image') assert.equal(JSON.parse(call.body).n, 1);
            if (nova.type === 'nova-models' && nova.operation === 'list') { assert.equal(call.url.searchParams.get('limit'), '5'); assert.equal(result.nova.response.last_id, 'friendly-model'); }
        } finally { clearTimeout(timer); await helper.unload(); }
    });
    assert.deepEqual([...covered].sort(), Object.keys(paths).sort());
    assert.deepEqual([...operations].sort(), ['list', 'retrieve']);
});
