# Obsidian Offline Whisper Transcription

Offline speech-to-text using Whisper

## Overview

This plugin provides speech-to-text transcription for Obsidian using Whisper models. It is designed to function entirely offline after the initial model download. It supports both desktop and mobile environments.

## Platform Implementation

The plugin uses different underlying engines to ensure performance and compatibility across devices.

On desktop operating systems (Windows, MacOS, Linux), the plugin utilizes `whisper.cpp`. One first use, the appropriate `whisper.cpp` command-line binary is downloaded for the operating system.

On mobile operating systems (Android, iOS), the plugin utilizes a bundled version of transformers.js that runs via WebAssembly.

## Model Selection

Navigate to the plugin settings to select a model. Models are downloaded from Hugging Face on first use. The larger the model, the slower it is. On the tested devices, the "base" model works on mobile devices and the "small" model works on desktop devices. It is recommended that you choose the largest model that can keep up with transcribing speech.

## Usage

In any note, select the ribbon icon or the command palette 'Toggle Voice Transcription' command to start transcribing. Select it again to stop. The audio is not saved except briefly on desktop platforms to perform the transcription.

## Transcribing audio files embedded in a note

Notes that embed audio files (e.g. `![[Recording.m4a]]`, supporting `mp3, wav, m4a, ogg, 3gp, flac, webm`) can have those files transcribed directly, with the transcript inserted below the embed:

- Click the **Transcribe** button next to the embedded audio player (Live Preview and Reading view).
- Right-click the embedded audio player and choose **Transcribe**.
- Run the command **Transcribe audio in this note**, or click the audio-file ribbon icon in the sidebar, and pick a file from the list of audio files linked in the current note.

The transcript is written under a `Transcription` heading (level configurable in settings, default `##`). Transcribing an already-transcribed embed asks before replacing. The same Whisper model and regex filter settings used for live transcription are applied, and the same engines are used: whisper.cpp on desktop, transformers.js on mobile.

## Cleaning up transcripts

On desktop, transcripts can be passed through a small local language model that removes filler words (um, ah, you know), fixes punctuation and capitalisation, and splits the text into paragraphs with minimal changes to the wording.

- Use the **Clean up** button next to an audio embed, or the command **Clean up transcript in this note**.
- Optionally enable **Clean up transcripts** in settings to run automatically after each file transcription (off by default; live recordings are never cleaned up automatically).
- The original transcript is kept in a collapsed `> [!note]- Original transcript` callout below the cleaned text.
- The cleanup prompt is editable in settings. `{text}` is replaced with the transcript.
- The model and `llama-server` binary are downloaded into the plugin folder on first use (`models/` and `bin/`), like the Whisper model. Default model: Qwen2.5 0.5B Instruct (379 MB, Q4_K_M); Qwen2.5 1.5B (940 MB) is available in settings for better quality.
- Only one transcript is cleaned per request, and transcripts larger than the model's context window are left unchanged with a warning.

## Privacy

This plugin processes all audio data locally on your device. No audio recordings or transcriptions are transmitted to external servers at any point.

## Sources

On the desktop, this plugin will install an executable from one of these locations:

- https://github.com/ggerganov/whisper.cpp/releases/latest

- https://github.com/bizenlabs/whisper-cpp-macos-bin/releases/latest

- https://github.com/dscripka/whisper.cpp_binaries/releases/latest

Both the desktop and mobile versions fetch models from huggingface:

- (Desktop) https://huggingface.co/ggerganov/whisper.cpp

- (Mobile) https://huggingface.co/Xenova
