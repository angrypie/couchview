# Speech and dictation

**Audience:** People configuring speech input, and maintainers diagnosing it.

## Host-run dictation

On an Apple Silicon Mac running macOS 14 or newer, Couchview can use the independent
[CouchSpeech](https://github.com/angrypie/couchspeech) service for local FluidAudio transcription.
Install it from its Homebrew tap, start its per-user service, then opt Couchview into the installed
loopback API:

```sh
brew tap angrypie/couchspeech
brew install --HEAD couchspeech
couchspeech start
couchspeech status
couchview --enable-speech
# or
COUCHVIEW_ENABLE_SPEECH=1 couchview
```

The `dev.couchspeech.couchspeechd` LaunchAgent keeps only a lightweight HTTP daemon resident. It
starts one model worker on demand for every Couchview instance and compatible local client,
serializes bounded requests, and terminates the worker after five idle minutes so Core ML memory is
returned. CouchSpeech owns all service lifecycle commands:

```sh
couchspeech preload
couchspeech unload
couchspeech stop
couchspeech delete-models
couchspeech uninstall
```

`delete-models` unloads the worker before deleting only the Parakeet repository used by
CouchSpeech. `uninstall` preserves the downloaded model cache.

The daemon binds only to `127.0.0.1:52781`. `couchspeech start` copies the daemon, worker, and
`couchspeech-licenses/` directory to a stable, versioned directory under
`~/Library/Application Support/CouchSpeech/`, writes the LaunchAgent with absolute
executable paths, and stores its bearer credential in a private mode-0600 configuration outside the
plist and process arguments. Couchview continues to authorize browser and native requests at its
existing API boundary before proxying audio to this loopback service.

The shared web/iOS/Android inputs show a microphone when the daemon and client audio capture are
ready; the model may still be cold. Press once to record and again to stop. Couchview uploads a
private mono PCM WAV and inserts only the final successful transcript at the current selection. The
recording stays in memory through Couchview, HTTP, worker IPC, WAV decoding, and inference; no upload
or recording file is intentionally created. Recordings stop after five minutes, and Couchview does
not retain transcript history.

Native clients can record while connected over trusted LAN HTTP. Browsers expose microphones only
in a secure context, so use localhost or HTTPS rather than a plain `http://<LAN-IP>` page. LAN HTTP
is also unencrypted: use only a trusted network or terminate HTTPS in front of Couchview.

## Voice commands

Voice commands add local intent resolution to host transcription. They are a separate opt-in from
ordinary dictation and require both server flags:

```sh
couchview --enable-speech --enable-voice-commands
```

Then open **Settings**, edit the active profile, enable **Voice command button**, and apply the
profile. The toggle is off by default and is stored per profile. The host flag allows and prepares
Needle even when the profile toggle is off; the profile toggle controls whether that profile shows
the action button and accepts its keyboard controls.

The supported packaged end-to-end host path is currently an Apple Silicon Mac running macOS 14 or
newer because voice commands require the CouchSpeech service described above. Paired native clients
can use that host through the on-screen button, but this does not make CouchSpeech itself available
on iOS, Android, Windows, or Linux. Needle has native-library selectors for macOS, Linux, and
Windows, but Needle alone cannot provide voice commands without a compatible speech service.

### Recording controls

Press the floating voice-command button once to start recording and again to stop. Voice-command
recordings are limited to 20 seconds. On web, hold `V` to talk and release it to stop, or press
`Shift+V` to toggle recording. A `V` press shorter than 250 ms is cancelled; `Escape`, window blur,
or hiding the page cancels an active push-to-talk recording. These shortcuts are ignored while
typing in an input, text area, selector, editable region, or shortcut-capture control. Native uses
the on-screen button; the web keyboard listener is not installed there. Voice commands are not
active in the Terminal workspace.

### Interpretation, confirmation, and undo

After CouchSpeech returns an English transcript, the Couchview host sends that transcript to its
local Needle 2 worker. The current decision rules are:

- no recognized action opens the Commands palette with the transcript for review;
- one recognized action with at least 50% confidence executes immediately unless its catalogue
  entry is classified as dangerous; and
- lower-confidence results, multiple actions, and any dangerous action require confirmation.

The current catalogue contains navigation actions and reversible staging and review actions; it
does not commit changes, execute package commands, or type into the terminal. The confirmation
sheet shows the transcript, confidence, proposed actions, and optional Needle reasoning. If the
repository or relevant current-file state changes before execution, Couchview rejects the stale
action and asks for the command again.

When a stage, unstage, review, or unreview action changes file state, the success notice offers
**Undo** for ten seconds. Undo uses the captured repository and review revisions; if the repository
has changed, Couchview refuses the stale undo and refreshes the view.

### Needle installation and local data

On the first startup with `--enable-voice-commands` for a platform and engine version, Couchview
downloads the Needle 2.0.2 native runtime wheel over HTTPS from `Cactus-Compute/needle2` on Hugging
Face at pinned revision `17a803d95928ba33d3e9a0160e024d9565b5c3f2`. Both the declared and
streamed archive size, and the extracted native library, are limited to 64 MiB. A first install
therefore needs outbound access to Hugging Face; Couchview does not provide a separate offline
installer.

The extracted library is reused from persistent Couchview data under:

```sh
${XDG_DATA_HOME:-$HOME/.local/share}/couchview/needle/
```

As with the state database, only an absolute `XDG_DATA_HOME` is honored. Inference runs in a worker
on the Couchview host after installation. There is no cloud-inference fallback.

The transcript travels from the client to the Couchview host and is held long enough to resolve and
execute the request. Couchview does not persist voice-command transcript history. Normal inference
logs omit the transcript and reasoning; they contain the model name, duration, a coarse confidence
bucket, and result count. A confirmation sheet temporarily displays the transcript and reasoning
to the current client. Plain LAN HTTP remains observable in transit, so use HTTPS when the network
is not fully trusted.

If download or initialization fails, the capability changes to `failed` and the Settings card or
diagnostics dialog offers **Retry Needle installation**. Retry reuses a valid cached library when
present, otherwise it attempts the bounded download and initialization again. It never switches to
a cloud resolver.

### Contributor evaluation

Run the checked-in catalogue evaluation with:

```sh
bun run eval:voice-commands
```

It uses the same cached-or-downloaded pinned runtime and reports exact ordered matches plus unsafe
automatic resolutions for the fixed evaluation corpus. Unlike normal production logging, the
evaluation command intentionally prints its non-private fixture transcripts and failure reasoning
to the terminal.

[FluidAudio](https://github.com/FluidInference/FluidAudio) 0.15.5 and
[Hummingbird](https://github.com/hummingbird-project/hummingbird) 2 are Apache-2.0 software. The
standalone CouchSpeech package distributes their and all resolved Swift dependencies'
license/notice files; see the
[CouchSpeech repository](https://github.com/angrypie/couchspeech/tree/main/Licenses).
The Parakeet model is published by
[NVIDIA](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3).
