(function () {
    'use strict';
    var specs = SPECS_PLACEHOLDER;
    var aliases = {
        chat: ['chat', 'chat.completions', 'chat_completion', 'text-generation'],
        response: ['responses'], embeddings: ['embeddings', 'embedding'], image: ['images', 'image-generation', 'images.generate'],
        transcription: ['transcription', 'audio.transcriptions', 'audio:transcribe'], translation: ['translation', 'audio.translations', 'audio:translate'],
        speech: ['speech', 'tts', 'audio.speech', 'audio:synthesis'], speakers: ['diarization', 'audio.diarization']
    };
    // Unknown metadata is kept selectable: only recognized capability names justify exclusion.
    function compatible(model, kind) {
        var known = Object.keys(aliases).reduce(function (all, key) { return all.concat(aliases[key]); }, []);
        var caps = Array.isArray(model.capabilities) ? model.capabilities : [];
        return !aliases[kind] || !caps.some(function (cap) { return known.indexOf(cap) !== -1; }) || caps.some(function (cap) { return aliases[kind].indexOf(cap) !== -1; });
    }
    function discover(id, action) { return $.ajax({ url: 'nova-ai/connections/' + encodeURIComponent(id) + '/' + action, dataType: 'json', timeout: 125000 }); }
    function errorText(xhr) { return xhr.responseJSON && xhr.responseJSON.error || 'Cannot reach Nova. Check your connection and try Refresh models again.'; }
    RED.nodes.registerType('nova-connection', {
        category: 'config', defaults: { name: { value: '' }, baseUrl: { value: 'https://api.nova.datalabrotterdam.nl/v1', required: true, validate: function (v) { return /^https?:\/\/\S+$/.test(v); } }, configId: { value: '' }, timeout: { value: 120, required: true, validate: function (v) { return Number(v) > 0 && Number(v) <= 2147483; } } },
        credentials: { apiKey: { type: 'password' } },
        label: function () { return this.name || 'Nova connection'; },
        oneditprepare: function () {
            var node = this;
            $('#nova-test').on('click', function () {
                var status = $('#nova-test-status'), button = $(this);
                if (!node.id || node.changed || $('#node-config-input-apiKey').val() !== '__PWRD__' || $('#node-config-input-baseUrl').val() !== node.baseUrl || $('#node-config-input-configId').val() !== node.configId || String($('#node-config-input-timeout').val()) !== String(node.timeout)) {
                    status.text('Save and deploy the connection, then reopen it to test.'); return;
                }
                button.prop('disabled', true); status.text('Testing connection…');
                node._novaTest = discover(node.id, 'test').done(function (data) { status.text(data.message); }).fail(function (xhr) { if (xhr.statusText !== 'abort') status.text(errorText(xhr)); }).always(function () { button.prop('disabled', false); });
            });
        },
        oneditcancel: function () { if (this._novaTest) this._novaTest.abort(); },
        oneditsave: function () { if (this._novaTest) this._novaTest.abort(); }
    });
    specs.forEach(function (spec) {
        var kind = spec[0], defaults = { name: { value: '' }, connection: { value: '', type: 'nova-connection', required: true } };
        if (kind !== 'providers') defaults.model = { value: '', required: ['models', 'voices'].indexOf(kind) === -1 };
        if (kind === 'models') defaults.operation = { value: 'list' };
        spec[4].forEach(function (key) { defaults[key] = { value: '', validate: function (value) { if (value === '' || ['temperature', 'max_tokens', 'dimensions', 'imageCount', 'speed', 'limit'].indexOf(key) === -1) return true; var n = Number(value); return Number.isFinite(n) && (key === 'temperature' ? n >= 0 : n > 0) && (['max_tokens', 'dimensions', 'imageCount', 'limit'].indexOf(key) === -1 || Number.isInteger(n)); } }; });
        RED.nodes.registerType('nova-' + kind, {
            category: 'Nova AI', color: '#B8D8E8', defaults: defaults, inputs: 1, outputs: 1,
            icon: 'font-awesome/fa-' + spec[2], paletteLabel: spec[1], label: function () { return this.name || spec[1]; },
            oneditprepare: function () {
                var node = this, generation = 0;
                $('#node-input-model').attr('list', 'nova-model-list');
                function refresh() {
                    var id = $('#node-input-connection').val(), status = $('#nova-model-status'), current = ++generation;
                    if (node._novaDiscovery) node._novaDiscovery.abort();
                    $('#nova-model-list').empty();
                    $('#node-input-model').off('input.nova');
                    $('#nova-refresh').prop('disabled', false);
                    var connection = RED.nodes.node(id);
                    if (!connection || connection.changed) { status.text('Save and deploy the connection before browsing. You can enter a model identifier manually.'); return; }
                    status.text('Loading models…'); $('#nova-refresh').prop('disabled', true);
                    node._novaDiscovery = discover(id, 'models').done(function (data) {
                        if (generation !== current) return;
                        var models = data.models.filter(function (m) { return compatible(m, kind); });
                        models.forEach(function (m) { $('<option>').val(m.id).text((m.name || m.id) + ' — ' + m.id + (m.capabilities ? ' (' + m.capabilities.join(', ') + ')' : '')).appendTo('#nova-model-list'); });
                        function message() {
                            var saved = $('#node-input-model').val();
                            status.text(saved && !models.some(function (m) { return m.id === saved; }) ? 'This model was not found for this operation. Its identifier is preserved; verify access or choose another.' : models.length ? models.length + ' models available. Search or enter an identifier.' : 'No models found. Check key permissions or enter a model identifier manually.');
                        }
                        $('#node-input-model').off('input.nova').on('input.nova', message); message();
                    }).fail(function (xhr) { if (generation === current && xhr.statusText !== 'abort') status.text(errorText(xhr)); }).always(function () { if (generation === current) $('#nova-refresh').prop('disabled', false); });
                }
                $('#nova-refresh').on('click', refresh);
                $('#node-input-connection').on('change', refresh);
                if (kind === 'models') {
                    function operation() { var retrieve = $('#node-input-operation').val() === 'retrieve'; $('#nova-model-section').toggle(retrieve); $('#nova-advanced').toggle(!retrieve); }
                    $('#node-input-operation').on('change', operation); operation();
                }
                if (kind !== 'providers') refresh();
            },
            oneditcancel: function () { if (this._novaDiscovery) this._novaDiscovery.abort(); },
            oneditsave: function () { if (this._novaDiscovery) this._novaDiscovery.abort(); }
        });
    });
}());
