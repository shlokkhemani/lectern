---
title: Lectern
---

<!-- Each split scene shows a real file from lectern/ on the left (it passes `lectern check` on its own)
and, on the right, the same block with the same narration and cues. The extra [hl md:…] cues here only
light the file's lines as they are spoken. -->

## Almost all of it is salty
::: code md src=lectern/water.md:5-16 lang=markdown "water.md" @left
::: chart water format=%
Oceans: 96.5
Ice: 1.7
Groundwater: 1.7
Rivers and lakes: 0.01
:::
[hl md:12] Almost all of Earth's water [hl md:13; grow water] sits in the oceans. [hl md:14] The fresh water we drink from [hl md:15; hl water:4] rivers and lakes [hl md:16] is a sliver too thin to see.

## Almost all of it is salty
::: md @left
::: water
[hl none] That was this file.

[hl md:5] A heading is a scene.

[hl md:6-11; hl water] A block is a picture.

[hl md:12-16] A paragraph is what the voice says. [hl md:13,15; hl water:4] Brackets change the picture as the voice reaches them.

## Where the file comes from
::: md @left
::: graph flow dir=TB
ask: you ask for a video
file: an agent writes `water.md`
mp4: Lectern makes `water.mp4`
ask -> file
file -> mp4
:::
[grow flow:ask] You ask an agent for a video. [grow flow:file; hl md:5-16] It writes a file like this one. [grow flow:mp4] Lectern makes the video.

[hl none] Three more files.

## Sort a list
::: code file1 src=lectern/sort.md:5-14 lang=markdown "sort.md" @left
::: code sort lang=python
nums = [3, 1, 2]
nums.sort()
print(nums)
:::
[hl file1:12; hl sort:1] Make a list, [hl file1:13; hl sort:2] sort it, [hl file1:14; hl sort:3] and print it.

## Three generations
::: code file2 src=lectern/family.md:5-16 lang=markdown "family.md" @left
::: tree fam
Grandma
  Mum
    Me
  Uncle
    Cousin
:::
[hl file2:14; grow fam:1] Grandma had [hl file2:15; grow fam:2,4] two children, [hl file2:16; grow fam:3,5] and each had a child.

## A ball on a hill
::: code file3 src=lectern/hill.md:5-13 lang=markdown "hill.md" @left
::: chart hill y="height, m"
x: 0 1 2 3 4
hill: 9 8 5 2 1
point hill 0: ball #ball
:::
[hl file3:12] The ball starts at the top. [hl file3:13; move ball 4] It rolls to the bottom.

##
::: title end
Write Markdown. Get a video.
github.com/shlokkhemani/lectern
:::
Write Markdown. Get a video.
