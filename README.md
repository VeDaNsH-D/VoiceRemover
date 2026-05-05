# VoiceRemover

An AI-powered web application that separates vocals from instruments in any audio file — inspired by [vocalremover.org](https://vocalremover.org/).

![VoiceRemover UI](https://github.com/user-attachments/assets/df5c009c-1d08-4c72-83d9-fddf5e766933)

## Features

- 🎤 **Vocal / Accompaniment separation** using spectral centre-channel extraction
- 🎵 **Interactive waveform player** — scrub, play/pause, and adjust volume for each stem
- 🗂 **Multiple formats** — MP3, WAV, FLAC, OGG, M4A (up to 50 MB)
- 📥 **One-click stem downloads** as stereo WAV files
- 🔒 **Private** — uploaded files are session-scoped and never persisted permanently
- 🌑 **Dark, animated UI** with gradient blobs, progress steps, and toast notifications

## Tech Stack

| Layer     | Technology                               |
|-----------|------------------------------------------|
| Backend   | Python · Flask · NumPy · SciPy · SoundFile |
| Frontend  | Vanilla JS · WaveSurfer.js · CSS custom properties |

## Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Run the development server
python app.py
```

Then open **http://localhost:5000** in your browser.

## How It Works

1. **Upload** — drag & drop or browse for an MP3 / WAV / FLAC / OGG / M4A file
2. **Process** — the server applies stereo centre-channel extraction:
   - **Vocals** = `(L + R) / 2`  (content common to both channels)
   - **Accompaniment** = `(L − R) / 2`  (stereo-panned instruments), high-pass filtered to remove residual low-end
3. **Listen & Download** — each stem is shown as an interactive waveform; download as WAV

## Project Structure

```
VoiceRemover/
├── app.py                  # Flask backend + audio separation logic
├── requirements.txt
├── templates/
│   └── index.html          # Single-page app template
└── static/
    ├── css/styles.css      # Dark-theme styles
    └── js/main.js          # Upload · WaveSurfer · playback logic
```
