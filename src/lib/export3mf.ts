import JSZip from 'jszip';
import * as THREE from 'three';
import { MINIMAL_PROJECT_SETTINGS, KROMACUT_CONFIG } from './slicerDefaults';
import { clampProgress, exportMeshProgress, exportZipProgress, progressInSpan } from './progress';

export interface Export3MFOptions {
    layerHeight?: number;
    firstLayerHeight?: number;
    layerFilamentColors?: string[]; // Optional per-layer filament colors (hex) for export
    onProgress?: (progress: number) => void;
}

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0,
            v = c == 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

export async function exportObjectTo3MFBlob(
    root: THREE.Object3D,
    options?: Export3MFOptions
): Promise<Blob> {
    const zip = new JSZip();

    // [Content_Types].xml
    const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="png" ContentType="image/png"/>
 <Default Extension="config" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;
    zip.file('[Content_Types].xml', contentTypes);

    // _rels/.rels
    const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
 <Relationship Target="/Metadata/model_settings.config" Id="rel1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;
    zip.folder('_rels')?.file('.rels', rels);

    // Collect visible meshes. Each preview layer should already be one manifold mesh,
    // so each visible mesh maps directly to one 3MF object.
    const meshes: THREE.Mesh[] = [];
    root.updateMatrixWorld(true);
    root.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
            const m = obj as THREE.Mesh;
            if (m.geometry && m.visible) {
                meshes.push(m);
            }
        }
    });

    if (meshes.length === 0) throw new Error('No meshes to export');

    // Collect materials (colors)
    // We map hex string -> index in basematerials
    const colorMap = new Map<string, number>();
    const colors: string[] = [];

    const normalizeHex = (hex?: string): string | null => {
        if (!hex) return null;
        const cleaned = hex.replace('#', '').toUpperCase();
        return cleaned.length === 6 ? cleaned : null;
    };

    const getMaterialIndex = (
        material: THREE.Material | THREE.Material[],
        overrideHex?: string
    ): number => {
        const mat = Array.isArray(material) ? material[0] : material;
        let hex = normalizeHex(overrideHex) || 'FFFFFF';
        if (!overrideHex && 'color' in mat && (mat as THREE.MeshStandardMaterial).color) {
            hex = (mat as THREE.MeshStandardMaterial).color.getHexString().toUpperCase();
        }
        if (!colorMap.has(hex)) {
            colorMap.set(hex, colors.length);
            colors.push(hex);
        }
        return colorMap.get(hex)!;
    };

    // Pre-calculate all materials so we can write the header correctly
    for (let i = 0; i < meshes.length; i++) {
        getMaterialIndex(meshes[i].material, options?.layerFilamentColors?.[i]);
    }

    // Prepare Project Settings (Minimal)
    const projectSettings = { ...MINIMAL_PROJECT_SETTINGS };

    // Apply user options
    if (options?.layerHeight) {
        projectSettings.layer_height = options.layerHeight.toString();
    }
    if (options?.firstLayerHeight) {
        projectSettings.initial_layer_print_height = options.firstLayerHeight.toString();
    }

    // Apply Colors/Filaments
    // Ensure we have at least one color if none found (fallback to white)
    const exportColors = colors.length > 0 ? colors : ['FFFFFF'];

    // Helper to expand arrays to match color count
    const expand = (val: string, count: number) => Array(count).fill(val);

    projectSettings.filament_colour = exportColors.map((c) => '#' + c);

    projectSettings.filament_type = expand('PLA', exportColors.length);

    projectSettings.filament_settings_id = expand(
        'Generic PLA @Kromacut 0.4 nozzle',
        exportColors.length
    );

    projectSettings.filament_vendor = expand('Generic', exportColors.length);

    // Build object resources using a chunked writer to avoid OOM with massive arrays
    const xmlParts: string[] = [];
    let currentChunk = '';
    // Reduced chunk size to 10MB to be safer with string concatenation limits and memory pressure
    const CHUNK_SIZE = 10 * 1024 * 1024;

    const write = (str: string) => {
        currentChunk += str;
        if (currentChunk.length > CHUNK_SIZE) {
            xmlParts.push(currentChunk);
            currentChunk = '';
        }
    };

    // IDs: 1 = BaseMaterials, 2..N = Objects
    const baseMatId = 1;
    let nextId = 2;

    const COORD_SCALE = 100000;
    // Helper to format float - Optimized to avoid string allocations (toFixed/replace)
    const roundForExport = (n: number) => Math.round(n * COORD_SCALE) / COORD_SCALE;
    const f = (n: number) => {
        // Round to 5 decimal places
        return roundForExport(n).toString();
    };

    // Vector helper
    const v = new THREE.Vector3();

    // Store IDs of generated mesh objects to group them later
    const componentIds: number[] = [];
    // Store metadata for model_settings.config
    const componentMeta: { id: number; name: string; colorIdx: number }[] = [];

    // Header and BaseMaterials
    let header = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="Application">Kromacut_Print</metadata>
`;
    if (options?.layerHeight !== undefined) {
        header += ` <metadata name="slic3rpe:layer_height">${options.layerHeight}</metadata>
`;
    }
    if (options?.firstLayerHeight !== undefined) {
        header += ` <metadata name="slic3rpe:first_layer_height">${options.firstLayerHeight}</metadata>
`;
    }
    header += ` <resources>
`;

    // Write Base Materials if we have any
    if (colors.length > 0) {
        header += `  <basematerials id="${baseMatId}">
`;
        for (const hex of colors) {
            header += `   <base name="${hex}" displaycolor="#${hex}FF" />
`;
        }
        header += `  </basematerials>
`;
    }

    write(header);

    // Yield every N vertices/triangles to allow GC and UI updates
    const YIELD_EVERY = 5000;
    let opsSinceYield = 0;

    // Progress tracking
    const onProgress = options?.onProgress;
    const reportProgress = (value: number) => {
        onProgress?.(clampProgress(value));
    };
    const totalMeshes = meshes.length;
    // Mesh generation is the first 80%; zip generation owns the final 20%.
    const reportMeshProgress = (meshIdx: number, meshFrac: number) => {
        if (!onProgress) return;
        reportProgress(exportMeshProgress(meshIdx, totalMeshes, meshFrac));
    };

    for (let i = 0; i < meshes.length; i++) {
        const mesh = meshes[i];
        const overrideHex = options?.layerFilamentColors?.[i];
        const matIdx = getMaterialIndex(mesh.material, overrideHex);
        const objectId = nextId++;
        componentIds.push(objectId);

        let hex = normalizeHex(overrideHex) || 'FFFFFF';
        if (
            !overrideHex &&
            'color' in mesh.material &&
            (mesh.material as THREE.MeshStandardMaterial).color
        ) {
            hex = (mesh.material as THREE.MeshStandardMaterial).color.getHexString().toUpperCase();
        }
        // Use 1-based index for color/extruder
        componentMeta.push({
            id: objectId,
            name: `Layer ${i + 1} (#${hex})`,
            colorIdx: matIdx + 1,
        });

        const layerName = `Layer ${i + 1} (#${hex})`;
        const writeMeshObject = async (
            mesh: THREE.Mesh,
            meshObjectId: number,
            meshName: string,
            progressStart: number,
            progressSpan: number
        ) => {
            write(`<object id="${meshObjectId}" p:UUID="${generateUUID()}" pid="${baseMatId}" pindex="${matIdx}" type="model" name="${meshName}">
`);
            write(` <mesh>
`);
            const geom = mesh.geometry;
            const pos = geom.getAttribute('position');
            const index = geom.getIndex();
            const exportVertexMap = new Map<string, number>();
            const exportVertices: THREE.Vector3[] = [];
            const exportTriangles: number[] = [];
            const phaseProgress = (value: number) =>
                progressInSpan(progressStart, progressSpan, value);
            const COLLECT_START = phaseProgress(0);
            const COLLECT_END = phaseProgress(0.42);
            const VERTEX_WRITE_END = phaseProgress(0.68);
            const TRIANGLE_WRITE_END = phaseProgress(1);

            const getExportVertex = (vertexIndex: number) => {
                v.fromBufferAttribute(pos, vertexIndex).applyMatrix4(mesh.matrixWorld);
                const x = roundForExport(v.x);
                const y = roundForExport(v.y);
                const z = roundForExport(v.z);
                const key = `${x},${y},${z}`;
                const existing = exportVertexMap.get(key);

                if (existing !== undefined) {
                    return existing;
                }

                const exportIndex = exportVertices.length;
                exportVertexMap.set(key, exportIndex);
                exportVertices.push(new THREE.Vector3(x, y, z));
                return exportIndex;
            };

            const addExportTriangle = (a: number, b: number, c: number) => {
                const v1 = getExportVertex(a);
                const v2 = getExportVertex(b);
                const v3 = getExportVertex(c);

                if (v1 === v2 || v2 === v3 || v1 === v3) {
                    return;
                }

                const p1 = exportVertices[v1];
                const p2 = exportVertices[v2];
                const p3 = exportVertices[v3];
                const abx = p2.x - p1.x;
                const aby = p2.y - p1.y;
                const abz = p2.z - p1.z;
                const acx = p3.x - p1.x;
                const acy = p3.y - p1.y;
                const acz = p3.z - p1.z;
                const crossX = aby * acz - abz * acy;
                const crossY = abz * acx - abx * acz;
                const crossZ = abx * acy - aby * acx;

                if (crossX === 0 && crossY === 0 && crossZ === 0) {
                    return;
                }

                exportTriangles.push(v1, v2, v3);
            };

            if (index) {
                const elementCount = index.count;
                for (let j = 0; j < elementCount; j += 3) {
                    addExportTriangle(index.getX(j), index.getX(j + 1), index.getX(j + 2));
                    opsSinceYield++;
                    if (opsSinceYield > YIELD_EVERY) {
                        opsSinceYield = 0;
                        reportMeshProgress(
                            i,
                            progressInSpan(
                                COLLECT_START,
                                COLLECT_END - COLLECT_START,
                                (j + 3) / elementCount
                            )
                        );
                        await new Promise((resolve) => setTimeout(resolve, 0));
                    }
                }
            } else {
                const elementCount = pos.count;
                for (let j = 0; j < elementCount; j += 3) {
                    addExportTriangle(j, j + 1, j + 2);
                    opsSinceYield++;
                    if (opsSinceYield > YIELD_EVERY) {
                        opsSinceYield = 0;
                        reportMeshProgress(
                            i,
                            progressInSpan(
                                COLLECT_START,
                                COLLECT_END - COLLECT_START,
                                (j + 3) / elementCount
                            )
                        );
                        await new Promise((resolve) => setTimeout(resolve, 0));
                    }
                }
            }
            reportMeshProgress(i, COLLECT_END);

            write(`  <vertices>
`);

            for (let j = 0; j < exportVertices.length; j++) {
                const vertex = exportVertices[j];
                write(`   <vertex x="${f(vertex.x)}" y="${f(vertex.y)}" z="${f(vertex.z)}" />
`);

                opsSinceYield++;
                if (opsSinceYield > YIELD_EVERY) {
                    opsSinceYield = 0;
                    reportMeshProgress(
                        i,
                        progressInSpan(
                            COLLECT_END,
                            VERTEX_WRITE_END - COLLECT_END,
                            (j + 1) / exportVertices.length
                        )
                    );
                    await new Promise((resolve) => setTimeout(resolve, 0));
                }
            }
            reportMeshProgress(i, VERTEX_WRITE_END);
            write(`  </vertices>
`);
            write(`  <triangles>
`);

            for (let j = 0; j < exportTriangles.length; j += 3) {
                write(`   <triangle v1="${exportTriangles[j]}" v2="${exportTriangles[j + 1]}" v3="${exportTriangles[j + 2]}" />
`);
                opsSinceYield++;
                if (opsSinceYield > YIELD_EVERY) {
                    opsSinceYield = 0;
                    reportMeshProgress(
                        i,
                        progressInSpan(
                            VERTEX_WRITE_END,
                            TRIANGLE_WRITE_END - VERTEX_WRITE_END,
                            (j + 3) / exportTriangles.length
                        )
                    );
                    await new Promise((resolve) => setTimeout(resolve, 0));
                }
            }
            reportMeshProgress(i, TRIANGLE_WRITE_END);

            write(`  </triangles>
`);
            write(` </mesh>
`);
            write(`</object>
`);
        };

        await writeMeshObject(mesh, objectId, layerName, 0, 1);
    }

    // Assembly Object
    const assemblyId = nextId++;
    const assemblyUuid = generateUUID();
    write(`<object id="${assemblyId}" p:UUID="${assemblyUuid}" type="model" name="Kromacut Model">
`);
    write(` <components>
`);
    for (const id of componentIds) {
        const compUuid = generateUUID();
        write(`  <component objectid="${id}" p:UUID="${compUuid}" />
`);
    }
    write(` </components>
`);
    write(`</object>
`);

    write(` </resources>
`);
    write(` <build p:UUID="${generateUUID()}">
`);
    write(`<item objectid="${assemblyId}" p:UUID="${generateUUID()}" />
`);
    write(` </build>
`);
    write(`</model>`);

    // Flush remaining chunk
    if (currentChunk.length > 0) {
        xmlParts.push(currentChunk);
    }

    const finalBlob = new Blob(xmlParts, { type: 'text/xml' });

    zip.folder('3D')?.file('3dmodel.model', finalBlob);

    // Generate Metadata/model_settings.config
    // This is required for Bambu Studio / Orca Slicer / Creality Print to correctly identify
    // the multipart object structure and assign names/settings, avoiding the "profile selection" prompt
    // and enabling correct color assignment visualization.
    let modelSettings = `<?xml version="1.0" encoding="UTF-8"?>
<config>
 <object id="${assemblyId}">
  <metadata key="name" value="Kromacut Model"/>
  <metadata key="extruder" value="1"/>
`;
    for (const comp of componentMeta) {
        const safeName = comp.name
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        modelSettings += `  <part id="${comp.id}" subtype="normal_part">
   <metadata key="name" value="${safeName}"/>
   <metadata key="extruder" value="${comp.colorIdx}"/>
  </part>
`;
    }
    modelSettings += ` </object>
 <plate>
  <metadata key="plater_id" value="1"/>
  <metadata key="plater_name" value=""/>
  <metadata key="locked" value="false"/>
  <model_instance>
   <metadata key="object_id" value="${assemblyId}"/>
   <metadata key="instance_id" value="0"/>
  </model_instance>
 </plate>
 <assemble>
  <assemble_item object_id="${assemblyId}" instance_id="0" transform="1 0 0 0 1 0 0 0 1 110 110 0" offset="0 0 0" />
 </assemble>
</config>`;

    zip.folder('Metadata')?.file('model_settings.config', modelSettings);

    zip.folder('Metadata')?.file('kromacut.config', KROMACUT_CONFIG);
    zip.folder('Metadata')?.file(
        'project_settings.config',
        JSON.stringify(projectSettings, null, 4)
    );

    reportProgress(exportZipProgress(0));

    const blob = await zip.generateAsync(
        { type: 'blob' },
        onProgress
            ? (meta) => {
                  // zip progress goes from 80% to 100%
                  reportProgress(exportZipProgress(meta.percent / 100));
              }
            : undefined
    );
    reportProgress(exportZipProgress(1));
    return blob;
}
