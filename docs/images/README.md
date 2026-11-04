# README images

The README shows `editor.webp`, `playback.webp`, and `routing.webp`. Each one
is a 1920×1080 WebP at quality 82, in light mode, with the default Human
Warrior preview. Take each one again after a change that a user can see in it.

## Set up

1. Install the pinned release file and start the app with `pnpm dev`.
2. Set the browser page to 1920×1080 at a scale of 1.
3. If the app opens in the dark theme, select Light mode on the banner.
4. Open the Library. Open RestedXP Guides, then RestedXP Forever Guide (A),
   then Speedrun Guide 1-20.

## editor.webp

1. Open 6-11 Elwynn Forest, and wait for the map to load.
2. Select step 141. On the notice about the first edit, select Got it.
3. In the editor, select the Go to line of the step.
4. Put the pointer on the selected map pin, and turn the mouse wheel 5 steps
   to zoom in on the route.

## playback.webp

1. Open 1-6 Northshire. If the Library stays open, select Close library.
2. Select Playback.
3. Wait until the dock shows "Routed" in place of "Routing".
4. In the step list, select step 50.
5. Move the playhead forward in step 50 until the Character card shows level 4
   at 45% XP.
6. On the Character card, open Quest log and Items held.
7. Scroll the step list until step 38 is at the top.

## routing.webp

1. Open 1-6 Northshire, and select Routes on the map.
2. In the Route menu, select Import route text. Paste the text of
   [`routing.route.json`](routing.route.json), and select Import. The route
   starts at the human start point in Northshire Abbey and ends at the
   Rut'theran Village flight master.
3. Close the editor, and wait until the route summary shows each part of the
   trip.

## Encode

Move the pointer off the page, take each screenshot as a PNG, and encode it:

```sh
ffmpeg -i editor.png -c:v libwebp -quality 82 editor.webp
```
