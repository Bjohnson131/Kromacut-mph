---
title: Dedithering And Cleanup
slug: dedithering-cleanup
order: 50
description: Smooth isolated dithered pixels before building the model.
---

# Dedithering And Cleanup

Dedithering is a cleanup pass for images that contain isolated pixels or noisy dither patterns after color reduction. It is separate from quantization.

## When To Use Dedither

Use **Dedither** when:

- The reduced image has many one-pixel speckles.
- A region should be solid but has scattered off-color pixels.
- The 3D preview would create tiny color islands that are hard to print.

Avoid dedithering when:

- The stippled pattern is intentional.
- Small details are important.
- You have not reduced colors yet.

## Weight

**Weight** controls how many neighboring pixels must match before a pixel is kept. Lower values preserve more detail. Higher values smooth more aggressively.

Start at the default value. If speckles remain, increase **Weight** one step at a time.

## Passes

**Passes** controls how many times the cleanup runs. More passes can smooth stubborn noise, but they can also erase small details.

Use one pass first. Increase only when the image still looks noisy.

## Apply The Result

Click **Apply** in the Dedither panel to create a cleaned image. You can use **Undo** if the result removes too much detail.

## Dedither Versus Height Dithering

Dedither and Auto-paint **Height dithering** are different tools.

| Tool             | Where it appears      | What it changes                                          |
| ---------------- | --------------------- | -------------------------------------------------------- |
| Dedither         | 2D mode               | The image pixels before 3D generation.                   |
| Height dithering | Auto-paint in 3D mode | The generated height map for smoother tonal transitions. |

Next: [3D mode](3d-mode).
