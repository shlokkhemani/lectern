---
title: Lectern
series: made with Lectern
---

##
::: title intro
Lectern
Narrated explainer videos from one Markdown file
- an agent writes the file
- Lectern makes the video
:::
This video was made from one Markdown file.
[show hl intro:1] An agent wrote it,
[show hl intro:2] and Lectern made the video.

## The file behind this video
::: code md src=lectern.md:6-15 lang=markdown
[hl md:7-12] A block puts a title on screen, with two chips.

[hl md:14-15] A word in square brackets is a cue. It fires on the next spoken word, so each chip lit up as it was said.

[hl md:13-15] The rest is narration. Nothing says where things go, or how they look.

## What Lectern does with it
::: graph flow dir=TB
md: `lectern.md`
read: read the file
voice: voice, checked by transcription
lint: lay out and lint every frame
chrome: capture in headless Chrome
ffmpeg: encode with ffmpeg
mp4: MP4
srt: subtitles
html: step-through page
md -> read
read -> voice
read -> lint
voice -> chrome
lint -> chrome
chrome -> ffmpeg
ffmpeg -> mp4
ffmpeg -> srt
ffmpeg -> html
:::
[grow flow:md,read] Lectern reads the file. [grow flow:voice] It voices the narration and transcribes the take to check every word. [grow flow:lint] It lays out and lints every frame. [grow flow:chrome] Headless Chrome captures the frames, [grow flow:ffmpeg] ffmpeg encodes them, [grow flow:mp4,srt,html] and out come the video, subtitles, and a page to step through.

## When something does not fit
::: terminal err
$ lectern check rain.md
rain.md:6 S0·B0 "rain": error L410: "rain" needs 1207px; the row is 1152px
  fix: it has the whole row already: show a shorter excerpt, or split it into two blocks
gates: G1 schema pass · G2 layout FAIL · G3 audio pass · timing pass
:::
[hl err:1] Say an agent's table of monthly rainfall is too wide. [hl err:2] Check names the line and how many pixels it needs. [hl err:3] Then comes the fix, ready to apply. [hl err:4] Until it is fixed, no video is built.

## Fast enough to iterate
::: chart speed format="# s" x="seconds, for a 10-minute video"
check: 2
contact sheets: 4
cold build: 27
:::
[grow hl speed:1] For a ten-minute video, a check takes about two seconds. [grow hl speed:2] Contact sheets, about four. [grow hl speed:3] A cold build, about 27 seconds.

## Edit one line, rebuild one scene
::: tokens sc markers=edit
intro file steps errors speed cache roles close
1 2 3 4 5 6 7 8
:::
::: callout same
Same file, same voice: the same video, byte for byte.
:::
[move sc:edit 2; hl sc:2] Edit a line in the file scene, and only that scene is built again. [move sc:edit 5; hl sc:5] Same for the speed scene. The rest come from a cache.

[show same] That is safe because the same file and voice give the same video, byte for byte.

## Who does what
::: compare who
the agent writes
the narration
the blocks on screen
a cue where each change lands
---
Lectern does
layout, theme and motion
voice, timing and subtitles
capture and encoding
:::
[show hl who:1] So the agent writes the explanation. [show hl who:2] Lectern does everything else, and the agent never touches rendering code.

##
::: text end
One Markdown file in.
{em A narrated video out.}
:::
One Markdown file in, [show end:2] a narrated video out.
