---
title: FAQ
slug: faq
order: 100
description: Short answers to common Kromacut questions.
---

# FAQ

## What Is Transmission Distance?

Transmission Distance, or **TD**, describes how much light passes through a filament at a given thickness. Auto-paint uses TD to estimate how stacked filament layers will look.

Lower TD usually means a darker or more opaque filament. Higher TD usually means a lighter or more translucent filament.

## Should I Use Manual Or Auto-paint?

Use **Manual** when you want direct artistic control over color order and layer heights.

Use **Auto-paint** when you have real filament colors and TD values and want Kromacut to plan the stack automatically.

## Do I Need To Calibrate Filaments?

You can start with estimated TD values. You can also check whether the filament maker, seller, or community has published Transmission Distance values for the exact filament you own.

Calibration usually improves Auto-paint results, especially when published values are unavailable or the result still looks wrong. Calibration is most useful when:

- A filament is translucent.
- Two filaments are visually similar.
- You want repeatable results across projects.

## What Is The Difference Between Palette Colors And Filament Colors?

Palette colors are image colors used in 2D mode and Manual mode.

Filament colors are physical materials used by Auto-paint. Auto-paint can generate virtual layer colors from the physical filament stack, but the exported print plan is still based on real filaments.

## Why Does The 3D Preview Need A Build Button?

3D generation can be expensive. Kromacut waits for **Build 3D Model** so changing a setting does not repeatedly start and cancel heavy work.

## Can I Export Without Using 3D Mode?

Use 2D mode to download the processed image. Use 3D mode to build and export STL or 3MF models.

## Does Layer Preview Change The Export?

No. The **Layer Preview** range only changes what is visible in the preview. STL and 3MF exports include the full generated model.

## Which File Should I Print?

Choose **Download STL** for broad slicer compatibility and manual filament swaps.

Choose **Download 3MF** when your slicer supports color-aware 3MF files and you want to preserve colored layer objects.

## Why Are Heights Approximate?

Layer numbers depend on slicer behavior, especially first-layer height. Use the values shown in **Print Instructions**, then confirm the final swap layers in your slicer preview.

## Can I Share My Settings?

Yes. Export custom 2D palettes as `.kpal` files and Auto-paint filament profiles as `.kfil` files. Older `.kapp` filament profile files can still be imported.
