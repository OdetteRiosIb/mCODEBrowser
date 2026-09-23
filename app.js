import * as d3 from 'd3'; // <--- Make sure this is present!
import { interactive_tree } from './edam-tree-reusable-d3.js';
import { ontologyData } from 'ontology-data.js';


let myTree = null;
let treeInitialized = false;

/**
 * Converts the flat window.globalNodeRegistry (already built by the
 * jsTree browser view from your OWL/vowlData) into a nested hierarchy
 * { id, name, children, meta } that d3.hierarchy() can consume.
 * Nodes with no superclasses become top-level roots, gathered under
 * one synthetic "Ontology" root node (same idea as EDAM's own root).
 */
function buildHierarchyFromRegistry(registry) {
    function buildNode(id, path) {
        const node = registry[id];
        if (!node || path.includes(id)) return null; // guards against cycles
        const nextPath = [...path, id];
        const children = (node.meta.subclasses || [])
            .map(childId => buildNode(childId, nextPath))
            .filter(Boolean);

        return {
            id: node.id,
            name: node.text,
            meta: node.meta,
            children: children.length ? children : undefined
        };
    }

    const rootIds = Object.keys(registry).filter(id => registry[id].meta.superclasses.length === 0);
    const rootChildren = rootIds.map(id => buildNode(id, [])).filter(Boolean);

    return { id: '__root__', name: 'Ontology', children: rootChildren };
}

/** Populates the right-hand "Details of term" panel for a clicked node. */
function showNodeDetails(d) {
    if (!d || !d.data) return;
    const meta = d.data.meta || {};

    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value && value !== 'None' ? value : '-';
    };

    const titleEl = document.getElementById('panel-title');
    if (titleEl) titleEl.textContent = `Details of term "${d.data.name}"`;

    setText('val-rdfs-label', meta.rdfsLabel);
    setText('val-pref-label', meta.prefLabel);
    setText('val-definition', meta.comment);
    setText('val-comment', meta.rdfsComment);
    setText('val-uri', meta.iri);

    const fillPills = (cellId, ids) => {
        const cell = document.getElementById(cellId);
        if (!cell) return;
        cell.innerHTML = '';
        (ids || []).forEach(refId => {
            const refNode = window.globalNodeRegistry ? window.globalNodeRegistry[refId] : null;
            if (!refNode) return;
            const pill = document.createElement('span');
            pill.className = 'ontology-pill';
            pill.textContent = refNode.text;
            cell.appendChild(pill);
        });
    };

    fillPills('val-parents', meta.superclasses);
    fillPills('val-equivalent', meta.equivalent);
}

/**
 * Called by the tab-switch handler in index.html the first time the
 * "Visualization View" tab is opened (see window.initializeEdamGraphicView).
 * Waiting until then guarantees window.globalNodeRegistry is populated.
 */
window.initializeEdamGraphicView = function () {
    if (treeInitialized) return;

    if (!window.globalNodeRegistry || Object.keys(window.globalNodeRegistry).length === 0) {
        console.warn('Ontology registry not ready yet — cannot build the tree view.');
        return;
    }

    const hierarchyData = buildHierarchyFromRegistry(window.globalNodeRegistry);

    myTree = interactive_tree()
        .expandDepth(1)
        .onNodeClick(showNodeDetails);

    d3.select('#ontology-tree-container').call(myTree);
    myTree.data(hierarchyData);

    // Wire up the +/-/home zoom control buttons (see index.html markup)
    document.getElementById('tree-zoom-in')?.addEventListener('click', () => myTree.zoomIn());
    document.getElementById('tree-zoom-out')?.addEventListener('click', () => myTree.zoomOut());
    document.getElementById('tree-zoom-reset')?.addEventListener('click', () => myTree.resetZoom());

    treeInitialized = true;
    console.log('Ontology tree initialized successfully.');
};
