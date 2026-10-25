'use strict';

const DEFAULT_URL = 'https://api.nova.datalabrotterdam.nl/v1';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function fail(message) { throw new Error(message); }
function apiError(status, detail = '', speech = false) {
    if (status === 401) return 'Your API key was rejected. Update the Nova connection credentials.';
    if (status === 403) return 'Your API key cannot access this model. Choose another model or check its permissions.';
    if (status === 429) return 'Nova is rate limited. Wait before trying again.';
    if ([400, 422].includes(status)) {
        const action = speech ? 'Check Voice and Output format for this speech model. Use the Voices example to find supported voice identifiers.' : 'Check your model and request options, then try again.';
        return `Nova returned HTTP ${status}.${detail ? ' ' + detail : ''} ${action}`;
    }
    return `Nova returned HTTP ${status}. Check your model and request options, then try again.`;
}
function validationDetail(body, apiKey) {
    let parsed;
    try { parsed = JSON.parse(body); } catch { return ''; }
    let detail = parsed?.error?.message ?? parsed?.message ?? parsed?.detail;
    if (Array.isArray(detail)) detail = detail.map(item => {
        if (!object(item) || typeof item.msg !== 'string') return '';
        return (Array.isArray(item.loc) ? item.loc.filter(v => typeof v === 'string').join('.') + ': ' : '') + item.msg;
    }).filter(Boolean).join('; ');
    if (typeof detail !== 'string') return '';
    // Only selected validation messages are exposed; never echo headers, input, or raw bodies.
    if (apiKey) detail = detail.split(apiKey).join('[redacted]');
    return detail.replace(/Bearer\s+[^\s,;"'<>]+/gi, 'Bearer [redacted]').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 500);
}
async function request(connection, path, options = {}) {
    if (!connection.credentials?.apiKey) fail('Add an API key to your Nova connection.');
    const url = new URL((connection.baseUrl || DEFAULT_URL).replace(/\/+$/, '') + path);
    if (!['http:', 'https:'].includes(url.protocol)) fail('Use an HTTP or HTTPS Nova URL.');
    const timeout = Number(connection.timeout || 120);
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 2147483) fail('Set a valid connection timeout in seconds.');
    const controller = new AbortController();
    connection.pending.add(controller);
    connection.owner?.pending.add(controller);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout * 1000);
    const configId = options.configId ?? connection.configId;
    let lastResponse;
    try {
        if (connection.closed) fail('Nova connection is closing. Deploy the flow again.');
        const { NovaAI } = await import('@datalabrotterdam/nova-sdk');
        const sdk = new NovaAI({ apiKey: connection.credentials.apiKey, baseUrl: connection.baseUrl || DEFAULT_URL, fetch: async (input, init = {}) => {
            const headers = new Headers(init.headers || {});
            if (configId && !headers.has('x-config-id')) headers.set('x-config-id', String(configId));
            const signals = [controller.signal, init.signal].filter(Boolean);
            const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
            const response = await fetch(input, { ...init, headers, signal, redirect: 'error' });
            lastResponse = response;
            return response;
        } });
        const body = options.body;
        const sdkOptions = { configId, signal: controller.signal };
        const query = new URL(url).searchParams;
        let data;
        if (path.startsWith('/models?')) data = await sdk.models.list({ limit: query.has('limit') ? Number(query.get('limit')) : undefined, after: query.get('after') || undefined });
        else if (path === '/models' && !body) data = await sdk.models.list();
        else if (path === '/providers' && !body) data = await sdk.providers.list();
        else if (path === '/audio/voices' && !body) data = await sdk.audio.voices.list(sdkOptions);
        else if (path === '/chat/completions') data = await sdk.chat.completions.create(body, sdkOptions);
        else if (path === '/embeddings') data = await sdk.embeddings.create(body, sdkOptions);
        else if (path === '/images/generations') data = await sdk.images.generations.create(body, sdkOptions);
        else if (path === '/audio/transcriptions') data = await sdk.audio.transcriptions.create(audioRequest(body), sdkOptions);
        else if (path === '/audio/translations') data = await sdk.audio.translations.create(audioRequest(body), sdkOptions);
        else if (path === '/audio/speech') data = await sdk.audio.speech.create(body, sdkOptions);
        else {
            // The SDK does not yet expose Responses, diarization, or model retrieval helpers.
            const headers = new Headers({ Authorization: `Bearer ${connection.credentials.apiKey}`, Accept: options.binary ? 'audio/*, application/octet-stream' : '*/*' });
            if (configId) headers.set('x-config-id', String(configId));
            let rawBody = body;
            if (rawBody && !(rawBody instanceof FormData)) { headers.set('Content-Type', 'application/json'); rawBody = JSON.stringify(rawBody); }
            const response = await sdk.fetch(url, { method: rawBody ? 'POST' : 'GET', headers, body: rawBody, signal: controller.signal, redirect: 'error' });
            lastResponse = response;
            if (!response.ok) {
                let detail = '';
                if ([400, 422].includes(response.status)) detail = validationDetail(await response.text(), connection.credentials.apiKey);
                else await response.body?.cancel();
                const error = new Error(apiError(response.status, detail, path.split('?')[0] === '/audio/speech'));
                error.status = response.status;
                throw error;
            }
            const contentType = response.headers.get('content-type') || '';
            if (options.binary) {
                if (!/^(audio\/|application\/octet-stream)/i.test(contentType)) fail('Nova did not return audio. Check the speech model and format.');
                data = Buffer.from(await response.arrayBuffer());
            } else if (/\bjson\b/i.test(contentType)) {
                try { data = await response.json(); } catch { fail('Nova returned invalid JSON. Check the server URL or try again.'); }
            } else if (options.text) data = await response.text();
            else fail('Nova returned an unexpected content type. Check the connection URL and model.');
        }
        const contentType = lastResponse?.headers.get('content-type') || '';
        if (/\bjson\b/i.test(contentType) && typeof data === 'string') fail('Nova returned invalid JSON. Check the server URL or try again.');
        if (!options.binary && !options.text && !/\bjson\b/i.test(contentType)) fail('Nova returned an unexpected content type. Check the connection URL and model.');
        if (options.binary && data instanceof Blob) data = Buffer.from(await data.arrayBuffer());
        if (options.binary && !/^(audio\/|application\/octet-stream)/i.test(contentType)) fail('Nova did not return audio. Check the speech model and format.');
        if (options.text && typeof data !== 'string') fail('Nova returned an unexpected content type. Check the connection URL and model.');
        return { response: data, status: lastResponse?.status || 200, contentType };
    } catch (error) {
        if (controller.signal.aborted) fail(timedOut ? 'Nova timed out. Increase the connection timeout or try a faster model.' : 'Nova request was cancelled because the node closed.');
        if (error?.name === 'NovaAIError') {
            const detail = [400, 422].includes(error.status) ? validationDetail(JSON.stringify(error.body), connection.credentials.apiKey) : '';
            const wrapped = new Error(apiError(error.status, detail, path.split('?')[0] === '/audio/speech'));
            wrapped.status = error.status;
            throw wrapped;
        }
        if (error instanceof TypeError) fail('Cannot reach Nova. Check the connection URL and network.');
        throw error;
    } finally { clearTimeout(timer); connection.pending.delete(controller); connection.owner?.pending.delete(controller); }
}
function audioRequest(form) {
    const result = {};
    for (const [key, value] of form.entries()) {
        if (key === 'file') result.file = value;
        else if (key === 'filename') result.filename = value;
        else result[key] = value;
    }
    return result;
}
const paths = { chat: '/chat/completions', response: '/responses', embeddings: '/embeddings', image: '/images/generations', transcription: '/audio/transcriptions', translation: '/audio/translations', speech: '/audio/speech', speakers: '/audio/diarization', models: '/models', providers: '/providers', voices: '/audio/voices' };
const uploads = ['transcription', 'translation', 'speakers'];
function prepare(kind, config, msg) {
    const nova = msg.nova ?? {};
    if (!object(nova) || (nova.request !== undefined && !object(nova.request))) fail('Set msg.nova.request to an object of Nova API options.');
    const body = {};
    for (const key of ['model', 'temperature', 'max_tokens', 'size', 'voice', 'language', 'response_format', 'dimensions', 'speed', 'n', 'limit', 'after']) {
        if (config[key] !== '' && config[key] !== undefined) body[key] = ['temperature', 'max_tokens', 'dimensions', 'speed', 'n', 'limit'].includes(key) ? Number(config[key]) : config[key];
    }
    if (kind === 'image' && config.imageCount !== '' && config.imageCount !== undefined) body.n = Number(config.imageCount);
    if (kind === 'chat') body.messages = typeof msg.payload === 'string' ? [{ role: 'user', content: msg.payload }] : msg.payload;
    if (['response', 'embeddings', 'speech'].includes(kind)) body.input = msg.payload;
    if (kind === 'image') body.prompt = msg.payload;
    if (uploads.includes(kind)) body.file = msg.payload;
    Object.assign(body, nova.request);
    if (body.stream !== undefined && body.stream !== false) fail('Streaming is not supported. Remove stream or set it to false.');
    if (!['models', 'providers', 'voices'].includes(kind) && (typeof body.model !== 'string' || !body.model.trim())) fail('Choose a model or set msg.nova.request.model.');
    if (kind === 'chat' && (!Array.isArray(body.messages) || !body.messages.length || body.messages.some(m => !object(m) || typeof m.role !== 'string'))) fail('Provide text or a non-empty array of chat messages in msg.payload.');
    if (kind === 'response' && !(typeof body.input === 'string' || Array.isArray(body.input))) fail('Provide text or an input-items array in msg.payload.');
    if (kind === 'embeddings' && !(typeof body.input === 'string' || (Array.isArray(body.input) && body.input.length && body.input.every(v => typeof v === 'string')))) fail('Provide text or an array of strings for embeddings.');
    if (['image', 'speech'].includes(kind) && (typeof body[kind === 'image' ? 'prompt' : 'input'] !== 'string' || !body[kind === 'image' ? 'prompt' : 'input'].trim())) fail('Provide non-empty text in msg.payload.');
    let path = paths[kind];
    if (['models', 'providers', 'voices'].includes(kind)) {
        if (kind === 'models' && config.operation === 'retrieve') {
            if (!body.model) fail('Enter the model identifier to retrieve.');
            path += '/' + encodeURIComponent(body.model);
        } else {
            const query = new URLSearchParams();
            for (const key of kind === 'models' ? ['limit', 'after'] : kind === 'voices' ? ['model'] : []) {
                if (body[key] !== undefined) query.set(key, body[key]);
            }
            if (body.limit !== undefined && (!Number.isInteger(Number(body.limit)) || Number(body.limit) <= 0)) fail('Set limit to a positive integer.');
            if (query.size) path += '?' + query;
        }
        return { path, configId: nova.configId };
    }
    if (uploads.includes(kind)) {
        if (!Buffer.isBuffer(body.file)) fail('Provide an audio Buffer in msg.payload. Use a File in node configured to return a Buffer.');
        const form = new FormData();
        const filename = String(msg.filename || 'audio.wav').split(/[\\/]/).pop() || 'audio.wav';
        form.append('file', new Blob([body.file], { type: msg.mimetype || 'application/octet-stream' }), filename);
        for (const [key, value] of Object.entries(body)) if (key !== 'file' && value !== undefined && value !== null) form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
        return { path, body: form, text: ['text', 'srt', 'vtt'].includes(body.response_format), configId: nova.configId };
    }
    return { path, body, binary: kind === 'speech', configId: nova.configId };
}
function output(kind, data, operation) {
    const malformed = () => fail('Nova returned an unexpected response. Check the selected model and API compatibility.');
    if (kind === 'chat') return data?.choices?.[0]?.message ? data.choices[0].message.content ?? null : malformed();
    if (kind === 'response') return Array.isArray(data?.output) ? data.output.flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text || '').join('') : malformed();
    if (kind === 'embeddings') return Array.isArray(data?.data) && data.data.every(item => Array.isArray(item.embedding)) ? data.data.map(item => item.embedding) : malformed();
    if (kind === 'image') return Array.isArray(data?.data) ? data.data : malformed();
    if (['transcription', 'translation'].includes(kind)) return typeof data === 'string' ? data : typeof data?.text === 'string' ? data.text : malformed();
    if (kind === 'speakers') return Array.isArray(data?.segments) ? data.segments : malformed();
    if (kind === 'speech') return data;
    if (kind === 'models' && operation === 'retrieve') return data?.id ? data : malformed();
    if (kind === 'voices') return Array.isArray(data?.voices) ? data.voices : Array.isArray(data?.data) ? data.data : malformed();
    return Array.isArray(data?.data) ? data.data : malformed();
}
async function allModels(connection) {
    const models = [], seen = new Set();
    let after;
    do {
        const result = await request(connection, '/models?limit=100' + (after ? '&after=' + encodeURIComponent(after) : ''));
        const page = result.response;
        if (!Array.isArray(page?.data) || page.data.some(model => !object(model) || typeof model.id !== 'string' || !model.id)) fail('Nova returned an invalid model list. Check the server URL.');
        models.push(...page.data);
        if (!page.has_more) break;
        after = page.last_id || page.data.at(-1)?.id;
        if (!after || seen.has(after)) fail('Nova returned a repeated pagination cursor. Try refreshing later.');
        seen.add(after);
        if (seen.size >= 1000) fail('Too many model pages. Contact your Nova administrator.');
    } while (true);
    return models;
}
module.exports = { DEFAULT_URL, request, prepare, output, allModels, paths };
