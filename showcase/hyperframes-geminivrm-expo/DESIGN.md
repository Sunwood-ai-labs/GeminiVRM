# GeminiVRM Expo Loop Design

## Style Prompt

Signal Booth is a dark cinematic exhibition-screen identity for GeminiVRM. It should feel like a live AI demo seen across a crowded booth: high-contrast, premium, animated, and immediately understandable. The avatar screenshots are treated as luminous stage material, not flat documentation. The viewer should remember one thing: conversation AI becomes visible.

## Colors

- `#070B12` Obsidian stage background
- `#EAF5FF` Cold paper text
- `#2F7CF6` Gemini signal blue
- `#00E6B1` Live mint accent
- `#FFB84D` Booth amber highlight
- `#162033` Deep panel ink

## Typography

- Display / Japanese headlines: `"Noto Sans JP"` at 800-900 weight, very large, tight tracking
- Latin labels and timer-like tags: `"League Gothic"` for compressed exhibit signage
- Body / micro labels: `"Montserrat"` with high letter spacing

## Components

- Full-frame dark stage with persistent signal grid, scanline grain, and moving light beams
- Screenshot slabs: large, tilted, glowing, treated like booth displays
- Signal chips: small labels with blue/mint borders, not generic pill buttons
- Transition wipes: signal bars cover scene changes; no hard cuts
- Kinetic emphasis words: one or two large terms per scene, not paragraph slides

## Motion Rules

- Every scene enters with staggered, varied GSAP `from()` motion
- Persistent screenshots get slow push-in or parallax
- Scene changes use signal bar wipes; scenes do not fade themselves out
- Final scene may dim out only at the very end

## What Not To Do

- No white presentation-card look
- No benchmark or developer-architecture slides for the exhibition loop
- No forced `<br>` line breaks; use deliberate line spans or natural wrapping
- No identical card grids
- No tiny UI text as the main message
