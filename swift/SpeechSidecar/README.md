# Couchview speech sidecar

This macOS ARM64 helper keeps FluidAudio's multilingual Parakeet TDT 0.6B v3 int8 model
loaded and accepts private local NDJSON requests from Couchview. It is disabled unless Couchview
is started with `--enable-speech` or `COUCHVIEW_ENABLE_SPEECH=1`.

The first enabled startup downloads the model into FluidAudio's normal user cache and warms it
before Couchview advertises dictation as ready. Subsequent startups reuse that cache. Audio is
passed by temporary path, is never written by this helper, and is deleted by the Couchview host
after every result.

FluidAudio is pinned to version 0.15.5 and is licensed under Apache-2.0:
<https://github.com/FluidInference/FluidAudio>. Parakeet TDT 0.6B v3 is published by NVIDIA:
<https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3>.
