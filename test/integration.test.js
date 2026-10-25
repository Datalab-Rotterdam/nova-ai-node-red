'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const helper = require('node-red-node-test-helper');
const register = require('../nodes/nova');
helper.init(require.resolve('node-red'));
let server, baseUrl, uploads = 0;
before(async () => {
    server = http.createServer(async (req, res) => {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/v1/chat/completions') {
            assert.equal(req.headers.authorization, 'Bearer mock-key');
            const request = JSON.parse(Buffer.concat(chunks)); assert.equal(request.model, 'friendly-model');
            res.end(JSON.stringify({ choices: [{ message: { content: 'Hello from the mock gateway!' } }] }));
        } else { uploads++; assert.match(Buffer.concat(chunks).toString(), /RIFF/); res.end('{"text":"Audio example works"}'); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
    await new Promise(resolve => helper.startServer(resolve));
});
after(async () => { await helper.unload(); await new Promise(resolve => helper.stopServer(resolve)); server.closeAllConnections(); server.close(); });
test('imported chat and audio examples run through actual Node-RED runtime with no Function node', async t => {
    for (const [filename, kind, payload, expected] of [
        ['01-first-chat.json', 'chat', 'Hello!', 'Hello from the mock gateway!'],
        ['02-audio-buffer.json', 'transcription', Buffer.from('RIFF mock wav'), 'Audio example works']
    ]) await t.test(kind, async () => {
        const example = JSON.parse(fs.readFileSync('examples/' + filename));
        assert.ok(!example.some(n => n.type === 'function'));
        const connection = example.find(n => n.type === 'nova-connection'); connection.baseUrl = baseUrl;
        const node = example.find(n => n.type === 'nova-' + kind); node.model = 'friendly-model'; node.wires = [['output']];
        const flow = [connection, node, { id: 'output', type: 'helper' }];
        await helper.load(register, flow, { [connection.id]: { apiKey: 'mock-key' } });
        const result = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Node-RED example timed out')), 3000);
            helper.getNode('output').once('input', msg => { clearTimeout(timer); resolve(msg); });
            helper.getNode(node.id).receive({ payload, topic: 'preserved' });
        });
        assert.equal(result.payload, expected); assert.equal(result.topic, 'preserved'); assert.equal(result.nova.status, 200);
        await helper.unload();
    });
    assert.equal(uploads, 1);
});
