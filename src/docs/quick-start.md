---
title: Quick Start
slug: quick-start
order: 20
description: A practical first run from image to export.
---

# Quick Start

This guide walks through a typical project from image loading to export.

## Load Or Import An Image

Use the upload button in the preview toolbar, drag an image into the 2D preview, or click **Load TD Test** in the header for a built-in practice image.

After loading, use the mouse wheel to zoom and drag the preview to pan. If the image has transparency, the checkerboard button can make transparent areas easier to see.

## Adjust The Image

In **2D**, use **Adjustments** before reducing colors. Exposure, contrast, highlights, shadows, whites, blacks, saturation, vibrance, hue, temperature, tint, and clarity can all change which colors the palette tools find.

Click **Apply** in the Adjustments panel when you want to bake the current adjustments into the image.

## Reduce Colors

In **Quantization Settings**:

1. Choose a **Palette** or leave it on **Auto**.
2. Set **Number of Colors** to the size you want to print or preview.
3. Choose an **Algorithm**.
4. Click **Apply**.

Use the **Image colors** panel to inspect the result. Click a swatch to edit or delete that color.

## Dedither Or Clean Up

If color reduction leaves isolated speckles, use **Dedither**. Start with the default **Weight** and **Passes**, then click **Apply**. Increase passes only when the image still looks noisy after one pass.

## Enable 3D Mode

Click **3D**. Set the print basics first:

- **Pixel Size (XY)** controls the physical width and depth of each image pixel.
- **Layer Height** should match the slicer layer height you plan to use.
- **First Layer Height** should match your slicer first-layer setting.
- **Smooth Meshing** can soften connected color boundaries for smoother geometry.

## Choose Manual Or Auto-paint

Use **Manual** when you want to directly tune the color stack. Drag colors to reorder them and use each row slider to set slice height.

Use **Auto-paint** when you want Kromacut to build a layer stack from your real filaments. Add filaments, set each color and TD, then use **Enhanced color matching** if you want the optimizer to search for a better filament order.

## Generate And Export

Click **Build 3D Model**. When the model appears, use the **Layer Preview** slider to inspect how the print builds from bottom to top.

Open the download menu and choose **Download STL** or **Download 3MF**. Then copy the **Print Instructions** so you have the start color, swap layers, and recommended slicer settings.

Next: [Generating and exporting output](generating-exporting-output#before-you-export).
