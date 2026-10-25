# Nova AI for Node-RED

Connect to Nova AI, choose a model, and build flows for chat, text, images, embeddings, and audio. Requires **Node-RED 4+** and **Node.js 22+**. MIT licensed. REST only; streaming and WebSockets are outside v1.

## Install

Install a published release through **Manage palette** by searching for `@datalabrotterdam/nova-ai-node-red`, or run in your Node-RED user directory (usually `~/.node-red`):

```sh
npm install @datalabrotterdam/nova-ai-node-red
```

If an npm release is not available yet, install the source from GitHub:

```sh
npm install git+https://github.com/Datalab-Rotterdam/nova-ai-node-red.git
```

For local development, install your checkout instead:

```sh
npm install /absolute/path/to/nova-ai-node-red
```

Restart Node-RED after installing.

### Install a release archive

Download the **Node-RED palette package (.tgz)** asset from [GitHub Releases](https://github.com/Datalab-Rotterdam/nova-ai-node-red/releases/latest). Its filename is `datalabrotterdam-nova-ai-node-red-<version>.tgz`. In Node-RED, open **Manage palette**, choose the module upload option, and select the downloaded file. This archive contains the packaged nodes and examples; choose it instead of GitHub's automatically generated source-code ZIP or tar.gz downloads.

You can also install the archive with `npm install /path/to/datalabrotterdam-nova-ai-node-red-<version>.tgz` in the Node-RED user directory, then restart Node-RED. This works while a new package is still propagating to the editor's community catalog.

## Your first reply

1. Choose **Import → Examples → @datalabrotterdam/nova-ai-node-red → 01-first-chat**.
2. Open **Chat**, add a **Nova connection**, enter your API key, and save both dialogs. The default URL is `https://api.nova.datalabrotterdam.nl/v1`.
3. Deploy to make the connection available to discovery. Node-RED may warn that the Chat model is still missing; deploy anyway. No request is made until you trigger the node.
4. Reopen Chat, press **Refresh models**, and search the Model field. Model names, identifiers and available capabilities appear in the suggestions. You can also type an identifier manually.
5. Select a model, click Done, deploy, then click **Say hello**. The Debug sidebar displays the reply. No Function node is needed.

To test your key, reopen the saved and deployed connection and press **Test connection**. It lists one model without generating billable content. Custom URL, routing ID, and the timeout (120 seconds by default) live under Advanced connection settings. Unsaved connection changes must be saved and deployed first. API keys use Node-RED password credentials and remain on the server; exported examples contain no credentials. Protect the Node-RED editor with your usual admin authentication and credential encryption settings.

## Example flows

Find all twelve flows under **Import → Examples → @datalabrotterdam/nova-ai-node-red**. Each runs only when you click Inject, includes Catch/error output, and works without a Function node. Select your existing Nova connection to reuse your key, or configure the included connection. Choose a compatible model where needed.

| Example | What to try |
| --- | --- |
| 01-first-chat | Send a greeting and see an assistant reply |
| 02-audio-buffer | Read a recording as a Buffer and transcribe it |
| 03-generate-response | Generate a short explanation from text |
| 04-create-embeddings | Turn two similar sentences into vectors |
| 05-generate-image | Generate a watercolor from a prompt |
| 06-translate-audio | Upload a recording and see translated text |
| 07-generate-speech | Generate an audio Buffer from a greeting |
| 08-identify-speakers | Find who spoke when in a conversation |
| 09-list-models | List five models; inspect the next-page cursor |
| 10-retrieve-model | Inspect one selected model's metadata |
| 11-list-providers | List providers using only your connection |
| 12-list-voices | Find presets to use in Generate speech |

New examples include a disabled **Full Nova result** Debug node: enable it to inspect the complete response and HTTP metadata. Flow Info and canvas comments explain setup and expected output. Models List and Providers need no model. Voices can require a speech model depending on the provider. For speech, connect a File out node and choose a destination to save the Buffer; the example itself does not write files.

For audio uploads in Docker, **File in reads a path inside the container**, such as `/data/recording.wav`. Copy or mount a recording there first; a Windows host path is not accessible directly. Keep File in set to a single Buffer. Translation targets, audio formats, voices, and image sizes depend on the selected model. Response and speaker-identification examples have the compatibility limits described below.

## Message contract

| Palette node | `msg.payload` input | `msg.payload` output |
| --- | --- | --- |
| Chat | Text or messages array | First assistant message content; `null` for tool-only replies |
| Generate response | Text or input-items array | Combined output text; empty string if there is no text |
| Create embeddings | Text or string array | Array of embedding vectors |
| Generate image | Prompt text | Array of image objects (URLs or base64, depending on provider) |
| Transcribe audio | Audio Buffer | Transcript or requested text/subtitle format |
| Translate audio | Audio Buffer | Translated transcript or requested text/subtitle format |
| Generate speech | Text | Audio Buffer |
| Identify speakers | Audio Buffer | Speaker segments |
| Models | Trigger | One page of models, or a model object for Retrieve |
| Providers | Trigger | Provider list |
| Voices | Trigger; optional model in editor | Preset voice list |

Every node preserves unrelated message properties and adds:

```js
msg.nova.response     // Full parsed response, text, or audio Buffer
msg.nova.status       // HTTP status, e.g. 200
msg.nova.contentType  // Returned Content-Type
```

Embeddings express text meaning as numbers so you can search for similar documents. Speaker identification, also called diarization, returns who spoke when, using labels rather than people's real identities.

Chat keeps no implicit conversation state. For a follow-up, provide the full conversation explicitly:

```json
[
  {"role":"user","content":"My name is Sam."},
  {"role":"assistant","content":"Hello Sam!"},
  {"role":"user","content":"What is my name?"}
]
```

Tool calls and structured results remain in `msg.nova.response`; this palette does not execute tools. Image size, speech voice, transcription language, and output format are available in the editor. Empty optional fields leave the choice to the provider. Available values vary by model.

### Audio

Import **02-audio-buffer**, choose an audio file in **File in**, add your key, deploy, select a transcription model, and deploy again. File in must return a **single Buffer**, not text or a stream of chunks. The Nova nodes upload Buffers using multipart form data. They never read paths. Optional `msg.filename` supplies a filename (directory components are stripped); `msg.mimetype` supplies a MIME type. Defaults are `audio.wav` and `application/octet-stream`. Generated speech is a Buffer suitable for a File out node. Preserve the returned content type when serving it over HTTP.

### Advanced options and pagination

Use a Change node or another upstream node to set `msg.nova.request` to an object of Nova API fields. These fields override editor defaults **and** inferred payload fields. For example:

```json
{"model":"your-model-id","temperature":0.2,"max_tokens":200}
```

For chat, `messages` overrides text from payload. For uploads, an overridden `file` must still be a Buffer. `msg.nova.configId` overrides the connection's routing ID through the `x-config-id` header. Do not set `stream: true`; streaming requests fail with an actionable Catch error. Input overrides remain on the message: clear or replace `msg.nova.request` before chaining operations when appropriate.

Models **List** returns exactly one page. Set `limit` and `after` in its editor or `msg.nova.request`. Read `msg.nova.response.has_more` and `last_id` to request the next page. **Retrieve** takes the model identifier from the editor or `msg.nova.request.model`. Editor discovery fetches every page separately. It filters only recognized capability metadata, retaining models without classified metadata. A missing saved model is preserved with a warning. Models can also be entered manually when discovery is unavailable.

### Errors

Wire a Catch node to handle authentication, permission, rate limit, network, timeout, input validation, or malformed response failures. HTTP 400/422 errors include the API's validation message when available, with the connection's API key and Bearer tokens redacted. Raw response bodies, validation input values, and server error diagnostics are not included. Requests are cancelled when their runtime node or connection closes. The package never retries requests automatically, so a billable generation is not silently repeated. No output message is sent after failure.

If Generate speech returns HTTP 400, check **Voice** first: some models require it even though others provide a default. Import **12-list-voices**, choose the same connection and speech model, deploy, and click Inject. Copy a returned voice identifier into Generate speech. If it still fails, inspect the validation message in Catch and choose an output format supported by that model. The palette leaves provider-specific values unset until you select them.

## API compatibility

The paths and routing/upload behavior were checked against the [published Nova SDK](https://www.npmjs.com/package/@datalabrotterdam/nova-sdk) 1.3.2. Generate response uses `POST /responses` with OpenAI-style `input` and `output[].content[]`. Identify speakers uses `POST /audio/diarization`, a multipart `file` and `model`, and expects a JSON `segments` array. These two paths respond with method-not-allowed to GET on the live gateway, but their schemas were not publicly available during implementation. Their contracts are mock-tested and **need live validation with your gateway version and a supplied key before release**. Provider-specific fields can be passed through `msg.nova.request`.

## Development and verification

```sh
npm ci
npm run build:editor
node scripts/build-examples.js
npm test
npm pack --dry-run
```

The runtime uses the official [`@datalabrotterdam/nova-sdk`](https://www.npmjs.com/package/@datalabrotterdam/nova-sdk) client for chat, embeddings, image generation, audio transcription/translation/speech, and model/provider/voice listing. The SDK is installed automatically with this palette; users do not need to add it separately. Responses, speaker diarization, and model retrieval use the SDK's configured fetch transport because the current SDK does not expose dedicated helpers for those endpoints. Dev dependencies provide Node-RED integration and editor tests. Edit `scripts/editor.js` or `scripts/build-editor.js` and regenerate `nodes/nova.html`. Example sources are generated by `scripts/build-examples.js`. Tests use a local mock HTTP gateway; they do not generate paid content. Real-key validation is a release check, not part of the automated test suite.

## Release instructions

Releases use the same semantic-release pattern as [nova-ai-cli](https://github.com/Datalab-Rotterdam/nova-ai-cli/blob/main/.github/workflows/ci.yml). The workflow in `.github/workflows/ci.yml` tests Node.js 22 and 24, regenerates the editor and examples, checks generated files, and inspects the package before publishing.

Every new release also creates a GitHub Release with release notes and the installable npm `.tgz` attached. The npm plugin writes the versioned archive to `release-assets/` after setting the release version, and the GitHub plugin uploads that file. Generated archives are excluded from Git. The release job's existing `contents: write` permission allows release creation and asset uploads.

On a push to `main`, semantic-release analyzes conventional commit messages, publishes to npm, creates a version tag, and commits the updated package files and changelog. Pushes to `alpha` publish prereleases under npm's `alpha` tag. Pull requests and other branches only run checks. A manual workflow run only runs checks. `fix:` commits produce patches, `feat:` commits produce minor releases, and breaking changes produce major releases. The first release starts at 1.0.0 when no earlier release tag exists; the version in package.json does not seed semantic-release's first version. Subsequent versions are managed automatically.

The release job references the organization's existing `NPM_TOKEN` secret through `NPM_TOKEN` and `NODE_AUTH_TOKEN`, matching the CLI's token fallback. It also grants the release job `id-token: write` and enables provenance for npm trusted publishing. No local npm login or copied token is needed. If publication fails, check that the organization secret is available to this repository and its npm token can publish under `@datalabrotterdam`. Trusted publishing additionally requires npm's trusted-publisher configuration for this exact repository and `ci.yml` workflow; the GitHub permission alone does not configure that trust. Do not put tokens in source files.

If npm stages the upload instead of making the version immediately installable, a maintainer must approve it on npm with 2FA. A successful CI job and a public `0.0.0-stage` placeholder do not mean the real version is available yet. Check the package's npm version before submitting it to the catalog.

Before publishing, validate all operations with an authorized Nova key, including response and diarization schemas. Inspect `npm pack --dry-run` and confirm scope ownership. After npm publication succeeds, submit `@datalabrotterdam/nova-ai-node-red` at the [Node-RED Flow Library](https://flows.nodered.org/add/node). The `node-red` keyword, node registration, and examples directory are already included. The catalog is a separate submission; a GitHub push alone does not add a package there.
