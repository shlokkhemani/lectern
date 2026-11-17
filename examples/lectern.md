---
title: Lectern
---

##
::: title intro
Lectern
AI agents write Markdown. Lectern makes the video.
:::
This is Lectern. It lets AI agents make videos. You ask an agent for a video, the agent writes one Markdown file, and Lectern turns that file into a narrated video.

## The agent writes a Markdown file
::: code md src=lectern/water.md:5-16 lang=markdown "water.md"
The agent writes a Markdown file like this one.

[hl md:5] A heading starts a scene. [hl md:6-11] A block is what's on screen: here, a bar chart.
[hl md:12-16] A paragraph is what the voice says. [hl md:13,15] A word in brackets is where the picture changes.

## You get a video
::: text cmd @top
`lectern build water.md`
:::
::: chart water format=%
Oceans: 96.5
Ice: 1.7
Groundwater: 1.7
Rivers and lakes: 0.01
:::
[hl none] Run one command, and you get this.

Almost all of Earth's water [grow water] sits in the oceans. The fresh water we drink from [hl water:4] rivers and lakes is a sliver too thin to see.

## What you get
::: bullets out
- an MP4 with voice and subtitles
- a subtitle file
- a web page that steps through it, scene by scene
:::
[show out:1] The video comes with voice and subtitles, [show out:2] a separate subtitle file, [show out:3] and a web page to step through it scene by scene.

## Who does what
::: compare roles
The agent writes
the narration
what's on screen
when it changes
---
Lectern does
the layout and colours
the voice and the timing
the subtitles and the video file
:::
[show roles:1] The agent writes what to say and what to show. [show roles:2] Lectern does everything else, so the agent spends its effort on the explanation.

## Built for agents
::: bullets agents
- one file, no rendering code
- every error names the line and the fix
- the same file rebuilds to the same video
:::
[show agents:1] The agent writes one file and no rendering code. [show agents:2] When something is wrong, Lectern names the line and the fix, so the agent can correct it alone. [show agents:3] And the same file always rebuilds to the same video.

## It's fast
::: chart speed format="# s" "Seconds, for a ten-minute video"
check the file: 2
preview every scene: 4
build the video: 27
:::
For a ten-minute video, [grow speed:1] checking the file takes two seconds, [grow speed:2] a preview of every scene takes four, [grow speed:3] and the finished video takes under thirty. Change one line, and only that scene is built again.

##
::: title end
Lectern
github.com/shlokkhemani/lectern
:::
Lectern is open source, on GitHub.
