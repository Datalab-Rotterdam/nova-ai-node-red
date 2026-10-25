'use strict';
const fs = require('node:fs');
fs.mkdirSync('examples', { recursive: true });
function base(id, label) { return [{ id, type: 'tab', label, disabled: false, info: 'Configure the Nova connection, deploy, select your model, and deploy again. No API key is included.' }, { id: id + '-connection', type: 'nova-connection', name: 'My Nova account', baseUrl: 'https://api.nova.datalabrotterdam.nl/v1', timeout: 120, configId: '' }]; }
const chat = base('nova-chat-example', 'Nova: first chat');
chat.push(
    { id: 'chat-guide', type: 'comment', z: chat[0].id, name: '1. Add API key in Chat → connection. 2. Deploy. 3. Pick model. 4. Deploy and click Inject.', x: 480, y: 80, wires: [] },
    { id: 'chat-inject', type: 'inject', z: chat[0].id, name: 'Say hello', props: [{ p: 'payload' }], payload: 'Hello! Explain what you can help me with in one sentence.', payloadType: 'str', repeat: '', once: false, x: 160, y: 160, wires: [['chat-node']] },
    { id: 'chat-node', type: 'nova-chat', z: chat[0].id, name: '', connection: chat[1].id, model: '', temperature: '', max_tokens: '', x: 390, y: 160, wires: [['chat-debug']] },
    { id: 'chat-debug', type: 'debug', z: chat[0].id, name: 'Assistant reply', active: true, tosidebar: true, complete: 'payload', targetType: 'msg', x: 620, y: 160, wires: [] },
    { id: 'chat-catch', type: 'catch', z: chat[0].id, name: 'Nova errors', scope: ['chat-node'], uncaught: false, x: 390, y: 240, wires: [['chat-errors']] },
    { id: 'chat-errors', type: 'debug', z: chat[0].id, name: 'Next action', active: true, tosidebar: true, complete: 'error.message', targetType: 'msg', x: 620, y: 240, wires: [] }
);
fs.writeFileSync('examples/01-first-chat.json', JSON.stringify(chat, null, 2) + '\n');
const audio = base('nova-audio-example', 'Nova: audio Buffer');
audio.push(
    { id: 'audio-guide', type: 'comment', z: audio[0].id, name: 'Set File in to your recording; add Nova key and choose a transcription model.', x: 400, y: 80, wires: [] },
    { id: 'audio-inject', type: 'inject', z: audio[0].id, name: 'Transcribe recording', props: [{ p: 'payload' }], payload: '', payloadType: 'date', once: false, x: 150, y: 160, wires: [['audio-file']] },
    { id: 'audio-file', type: 'file in', z: audio[0].id, name: 'Choose an audio file', filename: '', filenameType: 'str', format: '', chunk: false, sendError: false, allProps: false, x: 380, y: 160, wires: [['audio-node']] },
    { id: 'audio-node', type: 'nova-transcription', z: audio[0].id, name: '', connection: audio[1].id, model: '', language: '', response_format: '', x: 610, y: 160, wires: [['audio-debug']] },
    { id: 'audio-debug', type: 'debug', z: audio[0].id, name: 'Transcript', active: true, tosidebar: true, complete: 'payload', targetType: 'msg', x: 830, y: 160, wires: [] },
    { id: 'audio-catch', type: 'catch', z: audio[0].id, scope: ['audio-node', 'audio-file'], uncaught: false, x: 600, y: 240, wires: [['audio-error']] },
    { id: 'audio-error', type: 'debug', z: audio[0].id, name: 'Audio error', active: true, tosidebar: true, complete: 'error.message', targetType: 'msg', x: 830, y: 240, wires: [] }
);
fs.writeFileSync('examples/02-audio-buffer.json', JSON.stringify(audio, null, 2) + '\n');

function example({ filename, kind, title, trigger, payload = '', payloadType = 'str', result, note, options = {}, upload = false }) {
    const id = 'nova-example-' + filename.replace(/\.json$/, '');
    const flow = base(id, 'Nova: ' + title);
    flow[0].info = `# ${title}\n\n1. Open the Nova node and select an existing Nova connection, or add your API key to the included connection. Save and deploy.\n2. ${kind === 'providers' || (kind === 'models' && options.operation === 'list') ? 'This operation does not require a model.' : 'Reopen the Nova node and choose a compatible model, then deploy again.'}\n3. ${upload ? 'Set File in to an audio recording on the Node-RED server. In Docker, use a container path such as /data/recording.wav, not a Windows host path. File in returns a single Buffer. ' : ''}Click ${trigger}. Read ${result} in the Debug sidebar.\n\n${note}\n\nThe Full Nova result debug node is disabled by default; enable it to inspect msg.nova.response, status, and contentType. Catch shows errors and next actions. Nothing runs automatically on deploy. No API key is included.`;
    const nodeId = id + '-node';
    flow.push(
        { id: id + '-guide', type: 'comment', z: id, name: 'Add connection → deploy → choose model if needed → deploy → click Inject. See flow Info for details.', info: flow[0].info, x: 520, y: 60, wires: [] },
        { id: id + '-note', type: 'comment', z: id, name: note, x: 520, y: 110, wires: [] },
        { id: id + '-inject', type: 'inject', z: id, name: trigger, props: [{ p: 'payload' }], payload, payloadType, repeat: '', crontab: '', once: false, onceDelay: 0.1, x: 160, y: 190, wires: [[upload ? id + '-file' : nodeId]] }
    );
    if (upload) flow.push({ id: id + '-file', type: 'file in', z: id, name: 'Choose a server audio file', filename: '', filenameType: 'str', format: '', chunk: false, sendError: false, allProps: false, x: 400, y: 190, wires: [[nodeId]] });
    flow.push(
        { id: nodeId, type: 'nova-' + kind, z: id, name: '', connection: flow[1].id, ...(!['providers', 'models'].includes(kind) ? { model: '' } : {}), ...options, x: upload ? 650 : 440, y: 190, wires: [[id + '-debug', id + '-full']] },
        { id: id + '-debug', type: 'debug', z: id, name: result, active: true, tosidebar: true, complete: 'payload', targetType: 'msg', x: 900, y: 190, wires: [] },
        { id: id + '-full', type: 'debug', z: id, name: 'Full Nova result (enable to inspect)', active: false, tosidebar: true, complete: 'nova', targetType: 'msg', x: 950, y: 250, wires: [] },
        { id: id + '-catch', type: 'catch', z: id, name: 'Nova errors', scope: [nodeId, ...(upload ? [id + '-file'] : [])], uncaught: false, x: 640, y: 330, wires: [[id + '-error']] },
        { id: id + '-error', type: 'debug', z: id, name: 'Error and next action', active: true, tosidebar: true, complete: 'error.message', targetType: 'msg', x: 910, y: 330, wires: [] }
    );
    fs.writeFileSync('examples/' + filename, JSON.stringify(flow, null, 2) + '\n');
}

[
    { filename: '03-generate-response.json', kind: 'response', title: 'generate response', trigger: 'Ask for a summary', payload: 'Explain how a wind turbine makes electricity in two simple sentences.', result: 'Response text', note: 'Text goes in; combined output text comes out. Structured output remains in the full result.' },
    { filename: '04-create-embeddings.json', kind: 'embeddings', title: 'create embeddings', trigger: 'Embed two sentences', payload: JSON.stringify(['A bicycle beside a canal.', 'A bike parked by the water.']), payloadType: 'json', result: 'Two embedding vectors', note: 'Each sentence becomes a list of numbers representing its meaning; similar text has similar vectors.' },
    { filename: '05-generate-image.json', kind: 'image', title: 'generate image', trigger: 'Generate a canal image', payload: 'A cheerful watercolor of bicycles beside a Rotterdam canal, soft morning light.', result: 'Image objects', options: { size: '', imageCount: 1 }, note: 'Result contains image URLs or base64 data. Set Image size only when supported by your model.' },
    { filename: '06-translate-audio.json', kind: 'translation', title: 'translate audio', trigger: 'Translate recording', upload: true, result: 'Translated transcript', options: { response_format: '' }, note: 'Choose a recording in File in. Translation language and supported formats depend on the model.' },
    { filename: '07-generate-speech.json', kind: 'speech', title: 'generate speech', trigger: 'Speak a greeting', payload: 'Hello from Nova! Your Node-RED flow can now turn text into speech.', result: 'Audio Buffer', options: { voice: '', response_format: '', speed: '' }, note: 'Some models require Voice: run 12-list-voices with the same model and copy a preset. File out can save the audio Buffer.' },
    { filename: '08-identify-speakers.json', kind: 'speakers', title: 'identify speakers', trigger: 'Identify speakers in recording', upload: true, result: 'Who spoke when', note: 'Choose a conversation recording. Segments show speaker labels and timing, not real names.' },
    { filename: '09-list-models.json', kind: 'models', title: 'list models', trigger: 'List five models', payloadType: 'date', result: 'Models on this page', options: { operation: 'list', model: '', limit: 5, after: '' }, note: 'No model needed. Enable Full Nova result; use response.last_id as After model ID when response.has_more is true.' },
    { filename: '10-retrieve-model.json', kind: 'models', title: 'retrieve a model', trigger: 'Retrieve selected model', payloadType: 'date', result: 'Model details', options: { operation: 'retrieve', model: '' }, note: 'Select or enter a model identifier. Output is one model object with its available metadata.' },
    { filename: '11-list-providers.json', kind: 'providers', title: 'list providers', trigger: 'List providers', payloadType: 'date', result: 'Available providers', note: 'Only a Nova connection is required. Inspect the provider list in Debug.' },
    { filename: '12-list-voices.json', kind: 'voices', title: 'list voices', trigger: 'List preset voices', payloadType: 'date', result: 'Available voices', options: { model: '' }, note: 'Choose your speech model if required by the provider. Copy a returned preset into Generate speech → Voice.' }
].forEach(example);
