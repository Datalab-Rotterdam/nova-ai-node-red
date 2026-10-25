'use strict';
const client = require('./client');
module.exports = function (RED) {
    function Connection(config) {
        RED.nodes.createNode(this, config);
        this.baseUrl = config.baseUrl || client.DEFAULT_URL;
        this.timeout = config.timeout || 120;
        this.configId = config.configId || '';
        this.pending = new Set();
        this.on('close', () => { this.closed = true; for (const controller of this.pending) controller.abort(); });
    }
    RED.nodes.registerType('nova-connection', Connection, { credentials: { apiKey: { type: 'password' } } });
    for (const kind of Object.keys(client.paths)) {
        RED.nodes.registerType('nova-' + kind, function (config) {
            RED.nodes.createNode(this, config);
            const node = this, connection = RED.nodes.getNode(config.connection), pending = new Set();
            let closed = false;
            // Each runtime node owns its controllers so closing one does not cancel its siblings.
            const session = connection && Object.assign(Object.create(connection), { pending, owner: connection });
            node.on('close', () => { closed = true; if (session) session.closed = true; for (const controller of pending) controller.abort(); });
            node.on('input', async (msg, send, done) => {
                send = send || (message => node.send(message));
                done = done || (error => { if (error) node.error(error, msg); });
                try {
                    if (!session) throw new Error('Select a Nova connection before deploying.');
                    node.status({ fill: 'blue', shape: 'dot', text: 'requesting' });
                    const { path, ...options } = client.prepare(kind, config, msg);
                    const result = await client.request(session, path, options);
                    msg.payload = client.output(kind, result.response, config.operation);
                    msg.nova = { ...msg.nova, ...result };
                    if (!closed) { send(msg); node.status({ fill: 'green', shape: 'dot', text: 'complete' }); }
                    done();
                } catch (error) { if (!closed) node.status({ fill: 'red', shape: 'ring', text: 'failed — see Catch' }); done(error); }
            });
        });
    }
    for (const action of ['test', 'models']) {
        RED.httpAdmin.get('/nova-ai/connections/:id/' + action, RED.auth.needsPermission('nova-connection.read'), async (req, res) => {
            const connection = RED.nodes.getNode(req.params.id);
            res.set('Cache-Control', 'no-store');
            if (!connection || connection.type !== 'nova-connection') return res.status(404).json({ error: 'Save and deploy the Nova connection before testing or browsing models.' });
            try {
                if (action === 'models') res.json({ models: await client.allModels(connection) });
                else { const result = await client.request(connection, '/models?limit=1'); client.output('models', result.response); res.json({ message: 'Connected. Your API key can list models.' }); }
            } catch (error) { res.status(error.status || 502).json({ error: error.message }); }
        });
    }
};
