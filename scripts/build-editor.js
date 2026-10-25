'use strict';
const fs = require('node:fs');
const specs = [
    ['chat', 'Chat', 'comments', 'Send text or an array of messages; receive assistant content.', ['temperature', 'max_tokens']],
    ['response', 'Generate response', 'comment', 'Send text or input items; receive combined output text.', ['temperature']],
    ['embeddings', 'Create embeddings', 'th', 'Turn text into lists of numbers for finding similar text.', ['dimensions']],
    ['image', 'Generate image', 'picture-o', 'Describe an image; receive image objects with URLs or encoded data.', ['size', 'imageCount']],
    ['transcription', 'Transcribe audio', 'microphone', 'Turn an audio Buffer into written text.', ['language', 'response_format']],
    ['translation', 'Translate audio', 'language', 'Turn an audio Buffer into translated text.', ['response_format']],
    ['speech', 'Generate speech', 'volume-up', 'Turn text into an audio Buffer.', ['voice', 'response_format', 'speed']],
    ['speakers', 'Identify speakers', 'users', 'Find who spoke when in an audio Buffer; receive speaker segments.', []],
    ['models', 'Models', 'list', 'List one page of models or retrieve a model by identifier.', ['limit', 'after']],
    ['providers', 'Providers', 'cloud', 'List available Nova providers.', []],
    ['voices', 'Voices', 'bullhorn', 'List available preset voices for a speech model.', []]
];
const labels = { temperature: 'Creativity', max_tokens: 'Token limit', dimensions: 'Dimensions', size: 'Image size', imageCount: 'Image count', language: 'Language code', response_format: 'Output format', voice: 'Voice', speed: 'Speech speed', limit: 'Page size', after: 'After model ID' };
const numeric = ['temperature', 'max_tokens', 'dimensions', 'imageCount', 'speed', 'limit'];
function field(key, label, type = 'text', hint = '') { return `<div class="form-row"><label for="node-input-${key}">${label}</label><input type="${type}" id="node-input-${key}" ${type === 'number' ? 'step="any"' : ''}>${hint ? `<div class="form-tips">${hint}</div>` : ''}</div>`; }
const editor = fs.readFileSync('scripts/editor.js', 'utf8').replace('SPECS_PLACEHOLDER', JSON.stringify(specs));
let html = `<script type="text/javascript">\n${editor}\n</script>\n`;
html += `<script type="text/html" data-template-name="nova-connection">
<div class="form-row"><label for="node-config-input-name">Name</label><input id="node-config-input-name" type="text" placeholder="My Nova account"></div>
<div class="form-row"><label for="node-config-input-apiKey">API key</label><input id="node-config-input-apiKey" type="password" autocomplete="new-password"></div>
<details><summary>Advanced connection settings</summary>
<div class="form-row"><label for="node-config-input-baseUrl">API URL</label><input id="node-config-input-baseUrl" type="url"></div>
<div class="form-row"><label for="node-config-input-configId">Routing ID</label><input id="node-config-input-configId" type="text"></div>
<div class="form-row"><label for="node-config-input-timeout">Timeout (seconds)</label><input id="node-config-input-timeout" type="number" min="1" max="2147483"></div>
</details><p>Save and deploy this connection before testing it or browsing models. Testing lists models without generating content.</p>
<button type="button" class="red-ui-button" id="nova-test">Test connection</button><p id="nova-test-status" role="status" aria-live="polite"></p>
</script>
<script type="text/html" data-help-name="nova-connection"><p>Stores your Nova API key as a Node-RED password credential. The default API URL is https://api.nova.datalabrotterdam.nl/v1. Advanced routing selects a runtime configuration. The timeout is in seconds (default 120).</p><p>Save and deploy, then reopen to test. The test only lists models. Unsaved changes are not used by the test.</p></script>\n`;
for (const [kind, label, , description, options] of specs) {
    const model = !['providers'].includes(kind);
    html += `<script type="text/html" data-template-name="nova-${kind}">
${field('name', 'Name')}
<h4>Connection</h4>${field('connection', 'Nova connection')}
<p class="form-tips">Save and deploy the connection to browse models.</p>
${kind === 'models' ? '<div class="form-row"><label for="node-input-operation">Operation</label><select id="node-input-operation"><option value="list">List one page</option><option value="retrieve">Retrieve a model</option></select></div>' : ''}
${model ? `<div id="nova-model-section"><h4>Model</h4>${field('model', 'Model', 'text', 'Search discovered models or type a model identifier manually.')}<datalist id="nova-model-list"></datalist><button type="button" class="red-ui-button" id="nova-refresh">Refresh models</button><p id="nova-model-status" role="status" aria-live="polite"></p></div>` : ''}
${options.length ? '<h4>Options</h4>' : ''}
${options.filter(key => ['size', 'voice', 'language', 'response_format'].includes(key)).map(key => {
        if (key === 'response_format') {
            const formats = kind === 'speech' ? ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'] : ['json', 'text', 'srt', 'verbose_json', 'vtt'];
            return `<div class="form-row"><label for="node-input-response_format">Output format</label><select id="node-input-response_format"><option value="">Provider default</option>${formats.map(value => `<option value="${value}">${value}</option>`).join('')}</select></div>`;
        }
        return field(key, labels[key], 'text', key === 'language' ? 'Optional, for example nl or en.' : key === 'size' ? 'Optional, for example 1024x1024; check model support.' : 'Some models require a voice. Run the Voices example with this speech model and copy a supported identifier here.');
    }).join('')}
${options.some(key => !['size', 'voice', 'language', 'response_format'].includes(key)) ? '<details id="nova-advanced"><summary>Advanced options</summary>' + options.filter(key => !['size', 'voice', 'language', 'response_format'].includes(key)).map(key => field(key, labels[key], numeric.includes(key) ? 'number' : 'text')).join('') + '</details>' : ''}
<p class="form-tips">${description}</p>
</script>\n`;
    const input = ['transcription', 'translation', 'speakers'].includes(kind) ? 'Audio Buffer. Optional msg.filename and msg.mimetype describe the upload. File paths are never read.' : ['models', 'providers', 'voices'].includes(kind) ? 'Any trigger message.' : kind === 'chat' ? 'Text or a messages array, such as [{"role":"user","content":"Hello"}].' : kind === 'response' ? 'Text or an input-items array.' : kind === 'embeddings' ? 'Text or an array of strings.' : 'Text in msg.payload.';
    html += `<script type="text/html" data-help-name="nova-${kind}"><p>${description}</p><h3>Input</h3><p>${input}</p><h3>Output</h3><p>The useful result is in <code>msg.payload</code>. The complete response is in <code>msg.nova.response</code>, with <code>msg.nova.status</code> and <code>msg.nova.contentType</code>. Unrelated message properties are preserved.</p>${kind === 'chat' ? '<p>Chat has no hidden memory. Send the complete conversation as a messages array to continue it. Tool-only replies return null; inspect the full response for tool calls.</p>' : ''}${kind === 'response' ? '<p>A response without text returns an empty string. Structured output remains in the full response.</p>' : ''}${kind === 'embeddings' ? '<p>Embeddings represent meaning as numbers. Compare these vectors to find documents with similar meaning. Output is an array of vectors.</p>' : ''}${kind === 'speakers' ? '<p>Speaker identification (diarization) splits audio into segments showing who spoke when; labels do not identify people by name.</p>' : ''}${kind === 'models' ? '<p>List returns one page. Set Page size and After model ID, or override limit and after in msg.nova.request. Read has_more and last_id from the full response to request the next page.</p>' : ''}<h3>Example</h3><p>${['transcription', 'translation', 'speakers'].includes(kind) ? 'File in (single Buffer) → this node → Debug. Set the File in path to your audio file.' : ['models', 'providers', 'voices'].includes(kind) ? 'Inject → this node → Debug.' : 'Inject (text: Hello) → this node → Debug.'} Import the examples from the Node-RED Examples menu.</p><h3>Advanced</h3><p><code>msg.nova.request</code> is an object of API options. Its fields override editor settings and fields inferred from payload (for example <code>{model: "your-model"}</code>). <code>msg.nova.configId</code> overrides connection routing. Streaming is unsupported. Failures go to Catch nodes; requests time out and are cancelled when nodes close. Requests are never automatically retried.</p></script>\n`;
}
fs.writeFileSync('nodes/nova.html', html);
