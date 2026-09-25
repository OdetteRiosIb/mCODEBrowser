import * as d3 from "https://cdn.skypack.dev/d3@7";
import { interactive_tree } from './edam-tree-reusable-d3.js';

let myTree = null;
let treeInitialized = false;

/**
 * Converts the flat window.globalNodeRegistry (already built by the
 * jsTree browser view from your OWL/vowlData) into the nested
 * { id, text, meta, children } shape interactive_tree() expects
 * (its default identifierAccessor reads d.data.id, textAccessor reads
 * d.data.text, and initTreeAndTriggerUpdate() reads root.data.meta).
 * Nodes with no superclasses become top-level branches under one
 * synthetic "mCODE-ORCHID" root node, the same idea as EDAM's own root.
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
            text: node.text,
            meta: node.meta,
            children: children.length ? children : undefined
        };
    }

    const rootIds = Object.keys(registry).filter(id => registry[id].meta.superclasses.length === 0);
    const rootChildren = rootIds.map(id => buildNode(id, [])).filter(Boolean);

    return { id: '__root__', text: 'mCODE-ORCHID', meta: {}, children: rootChildren };
}

/** Populates the right-hand "Details of Class:" panel for the clicked node. */
function showNodeDetails(d) {
    if (!d || !d.data) return;
    const meta = d.data.meta || {};

    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value && value !== 'None' ? value : '-';
    };

    const titleEl = document.getElementById('panel-title');
    if (titleEl) {
        // If a node is selected, show its name; otherwise show a default header
        titleEl.textContent = d && d.data && d.data.text 
            ? `Details of term "${d.data.text}"` 
            : 'Details of term';
    }

    setText('val-rdfs-label', meta.rdfsLabel);
    setText('val-pref-label', meta.prefLabel);
    setText('val-definition', meta.comment);
    setText('val-comment', meta.rdfsComment);

    const copyToClipboard = (text, iconEl) => {
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
            if (!iconEl) return;
            const original = iconEl.textContent;
            iconEl.textContent = '✓';
            setTimeout(() => { iconEl.textContent = original; }, 1000);
        });
    };

    // URI / IRI rendered as a pill (like Class Parents), click to copy
    const uriCell = document.getElementById('val-uri-cell');
    if (uriCell) {
        uriCell.innerHTML = '';
        if (meta.iri && meta.iri !== 'None') {
            const pill = document.createElement('span');
            pill.className = 'ontology-pill iri-pill';
            pill.title = 'Click to copy IRI';

            const label = document.createElement('span');
            label.textContent = meta.iri;
            pill.appendChild(label);

            const icon = document.createElement('span');
            icon.className = 'ontology-pill-copy-icon';
            icon.textContent = '🗐';
            pill.appendChild(icon);

            pill.addEventListener('click', () => copyToClipboard(meta.iri, icon));
            uriCell.appendChild(pill);
        } else {
            uriCell.textContent = '-';
        }
    }

   const fillPills = (cellId, ids) => {
        const cell = document.getElementById(cellId);
        if (!cell) return;
        cell.innerHTML = '';
        (ids || []).forEach(refId => {
            const refNode = window.globalNodeRegistry ? window.globalNodeRegistry[refId] : null;
            if (!refNode) return;

            // 'pill' must be declared here within the loop scope
            const pill = document.createElement('span');
            pill.className = 'ontology-pill';
            pill.title = 'Click to copy IRI';

            const label = document.createElement('span');
            label.textContent = refNode.text;
            pill.appendChild(label);

            const icon = document.createElement('span');
            icon.className = 'ontology-pill-copy-icon';
            icon.textContent = '🗐';
            pill.appendChild(icon);

            pill.addEventListener('click', () => {
                copyToClipboard(refNode.meta ? refNode.meta.iri : null, icon);
            });

            cell.appendChild(pill);
        });
    };

    /** Renders meta.slots (populated by processOntologyData's propertiesList pass)
     *  filtered to one property type, as plain (non-clickable) pills. */
    const fillSlotPills = (cellId, slots, slotType, colorClass) => {
        const cell = document.getElementById(cellId);
        if (!cell) return;
        cell.innerHTML = '';
        (slots || []).filter(s => s.type === slotType).forEach(s => {
            const pill = document.createElement('span');
            pill.className = 'ontology-pill property-pill ' + colorClass;
            if (s.range) pill.title = `Range: ${s.range}`;
            pill.textContent = s.name;
            cell.appendChild(pill);
        });
    };

    fillPills('val-parents', meta.superclasses);
    fillPills('val-equivalent', meta.equivalent);
    fillSlotPills('val-object-properties', meta.slots, 'Object Property', 'property-pill-object');
    fillSlotPills('val-datatype-properties', meta.slots, 'Data Property', 'property-pill-data');

    // Mark this node as the visually "selected" (green) node, EDAM-style.
    if (myTree && myTree.cmd && d.data.id !== '__root__') {
        myTree.cmd.selectElement(d.data.id, true, false);
    }
}

/**
 * Called by the tab-switch handler already in index.html the first
 * time the "Visualization View" tab is opened. Waiting until then
 * guarantees window.globalNodeRegistry has been populated.
 */
window.initializeEdamGraphicView = function () {
    if (treeInitialized) return;

    if (!window.globalNodeRegistry || Object.keys(window.globalNodeRegistry).length === 0) {
        console.warn('Ontology registry not ready yet — cannot build the tree view.');
        return;
    }

    const hierarchyData = buildHierarchyFromRegistry(window.globalNodeRegistry);

    myTree = interactive_tree()
        .clickedElementHandler(showNodeDetails);

    // 1. Render the tree into its container (sets up the svg/zoom/update fns)
    d3.select('#ontology-tree-container').call(myTree);

    // 2. Pass the data — this triggers the first layout + collapse pass
    myTree.data(hierarchyData);

    // 3. Auto-expand just the root level so the top branches are visible
    //    on first load, matching EDAM's own default view.
    if (hierarchyData.children && hierarchyData.children.length) {
        myTree.cmd.expandElement(hierarchyData.children[0].id);
    }

    // Wire up the +/-/home zoom control buttons (see index.html markup)
    document.getElementById('tree-zoom-in')?.addEventListener('click', () => myTree.cmd.manualZoomInAndOut('in'));
    document.getElementById('tree-zoom-out')?.addEventListener('click', () => myTree.cmd.manualZoomInAndOut('out'));
    document.getElementById('tree-zoom-reset')?.addEventListener('click', () => myTree.cmd.resetPanAndZoom());
    document.getElementById('tree-expand-all')?.addEventListener('click', () => myTree.cmd.expandAllDescendantElement());
    document.getElementById('tree-collapse-all')?.addEventListener('click', () => myTree.cmd.collapseNotSelectedElement());

    treeInitialized = true;
    console.log('Ontology tree initialized successfully.');
};
