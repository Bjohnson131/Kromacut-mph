---
title: Loading Images
slug: loading-images
order: 30
description: Import, crop, pan, zoom, and manage the source image.
---

# Loading Images

Kromacut starts with one image. You can use your own image or the built-in TD test image.

## Choose A Source

Use any normal image file Kromacut can open in the web app or standalone desktop build. The preview toolbar includes a file upload button, and the preview area accepts drag and drop while you are in **2D** mode.

The header also includes **Load TD Test**. It loads a small bundled image for experimenting with Transmission Distance and layer ordering.

![TD test image](td-test.png 'Bundled TD test image')

## Preview Controls

The 2D preview is intentionally pixel-crisp so the reduced image shows exact color regions.

- Scroll to zoom in or out.
- Drag the image to pan.
- Use **Undo** and **Redo** after image edits such as crop, adjustment bake, dedither, quantize, swatch changes, or clear.
- Use **Toggle checkerboard** when transparent pixels are hard to see.
- Use **Download image** to save the current 2D result as an image.

## Crop The Image

Click **Crop** to enter crop mode. Drag the crop rectangle or its handles, then click **Save crop**. Use **Cancel crop** if you do not want to keep the selection.

Cropping is useful before color reduction because it removes background areas that would otherwise influence the palette.

## Remove Or Replace An Image

Use **Remove image** to clear the current image. To replace it, choose another file or drag a new image into the preview.

## Tips

- Start with the cleanest image you can. Heavy compression, tiny details, and noisy backgrounds usually become extra color regions.
- Crop first, then adjust, then reduce colors.
- Transparent border pixels are not useful for the 3D model. Keep only the visible subject area you want printed.

Next: [Reducing colors](reducing-colors).
