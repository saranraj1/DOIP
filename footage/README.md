# Footage — Sourcing Rules & Manifest

Video files are NOT committed to git. This directory holds `manifest.yaml` plus locally downloaded clips (gitignored).

## Path A (default): synthetic frames

The demo pipeline renders synthetic aerial frames from engine state — license-clean, perfectly ground-truthed, and zero download effort. **CI and the standard demo use Path A only.** Use real clips only when demonstrating detection on natural imagery.

## Path B: sourced clips

| Source | License | Allowed use |
|---|---|---|
| Pexels / Pixabay aerial clips | Pexels/Pixabay License (free) | Demos, docs — record per-clip in manifest |
| Wikimedia Commons | per-file (check each) | Only clearly-licensed files; record license per clip |
| VisDrone dataset | Academic/research ONLY | Fine-tuning demos only. NEVER in the default demo path. Restriction must stay noted here and in `THIRD_PARTY_LICENSES.md` |

Anything not in this table needs a license row + review before use.

## Processing

```bash
ffmpeg -i raw.mp4 -vf scale=1280:-2 -r 15 -t 60 -an clips/recon-04.mp4
```

Normalize: 720p · 15 fps · ≤60 s · no audio.

## manifest.yaml (mandatory — license column is not optional)

```yaml
clips:
  - file: clips/recon-04.mp4
    source_url: "https://www.pexels.com/video/..."
    license: "Pexels License"
    scenario: SC-2
    use: "vision review screen (S9) demo"
```

CI checks every clip referenced by a scenario or screen demo has a manifest entry with a license.
