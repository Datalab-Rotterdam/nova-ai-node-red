'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const jquery = require('jquery');
const html = fs.readFileSync('nodes/nova.html', 'utf8');
function editor(kind = 'chat', connection = { id: 'saved', changed: false }) {
    const dom = new JSDOM('<html><body></body></html>', { runScripts: 'outside-only' });
    const $ = jquery(dom.window), types = {}, requests = [];
    const source = new JSDOM(html).window.document;
    dom.window.document.body.innerHTML = source.querySelector(`[data-template-name="nova-${kind}"]`).innerHTML;
    const RED = { nodes: { registerType(name, def) { types[name] = def; }, node(id) { return id === connection?.id ? connection : null; }, dirty() { return true; } } };
    $.ajax = options => { const deferred = $.Deferred(); const promise = deferred.promise(); promise.abort = () => deferred.reject({ statusText: 'abort' }); requests.push({ options, deferred }); return promise; };
    dom.window.RED = RED; dom.window.$ = $;
    vm.runInContext(source.querySelector('script[type="text/javascript"]').textContent, dom.getInternalVMContext());
    if (kind !== 'connection') $('#node-input-connection').replaceWith('<select id="node-input-connection"><option value="saved">Saved</option></select>');
    return { dom, $, types, requests, prepare(node = {}) { types['nova-' + kind].oneditprepare.call(node); return node; } };
}
test('all dialogs have labeled fields, help, recognizable icons and native collapsed advanced controls', () => {
    const e = editor();
    const doc = new JSDOM(html).window.document;
    for (const [type, def] of Object.entries(e.types)) {
        const template = doc.querySelector(`[data-template-name="${type}"]`);
        assert.ok(template, type); assert.ok(doc.querySelector(`[data-help-name="${type}"]`));
        const body = new JSDOM(template.innerHTML).window.document;
        for (const field of body.querySelectorAll('input, select')) assert.ok(body.querySelector(`label[for="${field.id}"]`), field.id);
        for (const advanced of body.querySelectorAll('details')) { assert.equal(advanced.hasAttribute('open'), false); assert.ok(advanced.querySelector('summary')); }
        if (type !== 'nova-connection') { assert.equal(def.category, 'Nova AI'); assert.match(def.icon, /font-awesome/); assert.equal(def.inputs, 1); assert.equal(def.outputs, 1); }
        for (const reserved of ['id', 'type', 'x', 'y', 'z', 'wires', 'n']) assert.equal(Object.hasOwn(def.defaults, reserved), false, `${type}: reserved property ${reserved}`);
    }
});
test('model picker filters reliable capabilities but retains unclassified models and supports manual entry', () => {
    const e = editor(); const node = e.prepare();
    assert.equal(e.requests.length, 1); assert.match(e.$('#nova-model-status').text(), /Loading/);
    e.requests[0].deferred.resolve({ models: [
        { id: 'chat', name: 'Friendly model', capabilities: ['chat'] }, { id: 'embeddings', capabilities: ['embeddings'] }, { id: 'unknown' }, { id: 'future', capabilities: ['something-new'] }
    ] });
    const values = e.$('#nova-model-list option').map((i, item) => item.value).get();
    assert.deepEqual(values, ['chat', 'unknown', 'future']);
    assert.match(e.$('#nova-model-list').text(), /Friendly model/);
    assert.equal(e.$('#node-input-model').attr('list'), 'nova-model-list');
    e.$('#node-input-model').val('my-manual-model').trigger('input');
    assert.equal(e.$('#node-input-model').val(), 'my-manual-model'); assert.match(e.$('#nova-model-status').text(), /preserved/);
    assert.equal(e.$('#node-input-model').prop('disabled'), false);
    e.types['nova-chat'].oneditcancel.call(node);
});
test('picker handles empty, permission and network failures without clearing the saved model', () => {
    const e = editor(); e.$('#node-input-model').val('saved-model'); e.prepare();
    e.requests[0].deferred.resolve({ models: [] }); assert.match(e.$('#nova-model-status').text(), /preserved/);
    e.$('#nova-refresh').trigger('click'); e.requests[1].deferred.reject({ responseJSON: { error: 'Check key permissions.' } });
    assert.match(e.$('#nova-model-status').text(), /permissions/); assert.equal(e.$('#node-input-model').val(), 'saved-model');
    e.$('#nova-refresh').trigger('click'); e.requests[2].deferred.reject({}); assert.match(e.$('#nova-model-status').text(), /Cannot reach/);
    e.$('#node-input-model').val(''); e.$('#nova-refresh').trigger('click'); e.requests[3].deferred.resolve({ models: [] }); assert.match(e.$('#nova-model-status').text(), /No models found/);
});
test('unsaved connection blocks discovery, while unrelated dirty flows do not', () => {
    const e = editor('chat', { id: 'saved', changed: true }); e.prepare();
    assert.equal(e.requests.length, 0); assert.match(e.$('#nova-model-status').text(), /Save and deploy/);
    const saved = editor(); saved.prepare(); assert.equal(saved.requests.length, 1);
});
test('changing a connection cancels discovery and keeps refresh available', () => {
    const e = editor(); const node = e.prepare();
    assert.equal(e.$('#nova-refresh').prop('disabled'), true);
    e.$('#node-input-connection').val('').trigger('change');
    assert.equal(e.requests[0].deferred.state(), 'rejected');
    assert.equal(e.$('#nova-refresh').prop('disabled'), false);
    assert.match(e.$('#nova-model-status').text(), /Save and deploy/);
    assert.equal(e.$('#nova-model-list option').length, 0);
    e.types['nova-chat'].oneditcancel.call(node);
});
test('connection test requires saving changes and gives progress and results', () => {
    const e = editor('connection');
    const node = { id: 'saved', baseUrl: 'https://example.org/v1', timeout: 120, configId: '' };
    e.$('#node-config-input-apiKey').val('new-key'); e.$('#node-config-input-baseUrl').val(node.baseUrl); e.$('#node-config-input-timeout').val(120);
    e.prepare(node); e.$('#nova-test').trigger('click'); assert.equal(e.requests.length, 0); assert.match(e.$('#nova-test-status').text(), /Save and deploy/);
    e.$('#node-config-input-apiKey').val('__PWRD__'); e.$('#nova-test').trigger('click');
    assert.equal(e.requests.length, 1); assert.match(e.$('#nova-test-status').text(), /Testing/); assert.equal(e.$('#nova-test').prop('disabled'), true);
    assert.ok(!JSON.stringify(e.requests[0].options).includes('new-key'));
    e.requests[0].deferred.resolve({ message: 'Connected.' }); assert.equal(e.$('#nova-test-status').text(), 'Connected.');
    e.$('#nova-test').trigger('click'); e.requests[1].deferred.reject({ responseJSON: { error: 'Update key.' } }); assert.match(e.$('#nova-test-status').text(), /Update key/);
});
test('models operation shows only relevant controls and validates integer options', () => {
    const e = editor('models'); e.prepare();
    assert.equal(e.$('#nova-model-section').css('display'), 'none');
    e.$('#node-input-operation').val('retrieve').trigger('change');
    assert.notEqual(e.$('#nova-model-section').css('display'), 'none'); assert.equal(e.$('#nova-advanced').css('display'), 'none');
    assert.equal(e.types['nova-models'].defaults.limit.validate('1.5'), false);
    assert.equal(e.types['nova-models'].defaults.limit.validate('10'), true);
});
