---
title: 3D Mode
slug: 3d-mode
order: 60
description: Configure print dimensions, Manual layers, Auto-paint, and preview controls.
---

# 3D Mode

3D mode turns the prepared image into a printable layer stack. The model does not rebuild automatically; click **Build 3D Model** after changing 3D settings.

## 3D Print Settings

Set these before building:

| Setting            | What it controls                                                                |
| ------------------ | ------------------------------------------------------------------------------- |
| Pixel Size (XY)    | The physical width and depth of each image pixel, in mm per pixel.              |
| Layer Height       | The normal slicer layer height. Swap layers are calculated from this value.     |
| First Layer Height | The slicer first-layer height. This affects the first layer and swap positions. |
| Smooth Meshing     | Smooths connected color boundary edges with welded topology.                    |

Use the reset button to return print settings to the app defaults.

## Manual Mode

Manual mode uses the colors shown in **Image colors**.

Use **Color Slice Heights** to:

- Drag colors into the order you want them printed.
- Adjust each color's slice height.
- Reset all heights and sorting if the stack gets confusing.

The first color is the starting color. Later colors become swap steps. For best results, think from bottom to top: dark or backing colors usually go first, lighter colors often go later.

## Auto-paint

Auto-paint uses real filament colors and **Transmission Distance (TD)** values. Add each filament you plan to use, then set:

- Filament name.
- Filament color.
- TD value.

Use the wand button to auto-estimate TD from color, or use the calibration button to measure TD from printed test patches.

## Calibrating Filament TD

Click the calibration button on a filament row to open **Calibrate Filament TD**. The wizard has three parts:

1. **Step 1: Print Test Patches** lists the filament, layer height, 100% infill, patch size, and layer counts. Use **Download Test Patches STL** if you want Kromacut to generate the patch model.
2. **Step 2: Measure RGB Values** lets you enter measurements manually or upload a photo with **Image Sampler**. Use **Fill White Reference** on the empty backlight first, then use **Fill Measurement RGB** for each printed patch.
3. **Calibration Complete** shows the fitted TD value, RGB channel estimates, white reference, and confidence. Click **Save Calibration** to apply it to the filament.

Use at least three saved measurements before calculating TD. More measurements usually improve confidence if the lighting and sampling setup stays consistent.

## Filament Profiles

Auto-paint profiles store reusable filament sets.

- **Save changes to current profile** updates the selected profile.
- **Save as new profile** creates a new profile name.
- **Import profile from file** loads a `.kapp` or `.json` profile.
- **Export current filaments as .kapp file** shares the current filament setup.
- **Delete selected profile** removes the selected profile.

## Max Height

**Max Height** limits the total model height in Auto-paint. Leave it on **Auto** for the physics-derived height. Set a smaller value when the model is too tall, but watch for compressed transition zones.

## Enhanced Color Matching

Enable **Enhanced color matching** when filament order matters and you want Kromacut to optimize the stack.

Optional controls appear with enhanced matching:

- **Allow repeated filament swaps** lets the same filament appear more than once.
- **Height dithering** uses printable height dots to smooth tonal transitions.
- **Line width** should roughly match the printer line or nozzle width used for dither dots.
- **Optimizer Settings** let you choose **Algorithm**, **Region priority**, and an optional **Seed**.

## Optimizer Settings

| Setting         | Meaning                                                      |
| --------------- | ------------------------------------------------------------ |
| Algorithm       | Auto, Exhaustive, Simulated Annealing, or Genetic Algorithm. |
| Region priority | Uniform, Center-weighted, or Edge-weighted matching.         |
| Seed (optional) | A number that makes optimizer results repeatable.            |

Use **Auto (smart selection)** unless you have a reason to compare algorithms.

## Transition Zones And Confidence

After Auto-paint computes a result, Kromacut can show:

- **Transition Zones**, with height ranges and compressed-zone badges.
- **Result Confidence**, including Calibration, Coverage, and Compression scores.
- **Optimizer Performance**, including Algorithm, Quality Score, Iterations, Cache hit, and Converged.

Low confidence usually means you should calibrate filaments, add a missing filament color, or loosen a restrictive max height.

## Layer Preview

After building, the bottom **Layer Preview** bar lets you show only a height range of the model. Drag the lower and upper handles to inspect how the print builds.

Hover over color segments to see the start layer or swap layer. The preview range is only for inspection; exports still include the complete model.

Next: [Generating and exporting output](generating-exporting-output).
