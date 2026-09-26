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
    const built = new Map();      // id -> finished node, computed only once ever
    const inProgress = new Set(); // ids currently being built, guards against real cycles

    function buildNode(id) {
        if (built.has(id)) {
            // Already computed this class's subtree — reuse it, but return a fresh
            // wrapper object so D3 treats each occurrence as its own node instance.
            const cached = built.get(id);
            return { id: cached.id, text: cached.text, meta: cached.meta, children: cached.children };
        }
        if (inProgress.has(id)) return null; // guards against a genuine cycle in the data

        const node = registry[id];
        if (!node) return null;

        inProgress.add(id);
        const children = (node.meta.subclasses || [])
            .map(childId => buildNode(childId))
            .filter(Boolean);
        inProgress.delete(id);

        const result = {
            id: node.id,
            text: node.text,
            meta: node.meta,
            children: children.length ? children : undefined
        };
        built.set(id, result);
        return result;
    }

    const rootIds = Object.keys(registry).filter(id => registry[id].meta.superclasses.length === 0);
    const rootChildren = rootIds.map(id => buildNode(id)).filter(Boolean);

    return { id: '__root__', text: 'mCODE-ORCHID', meta: {}, children: rootChildren };
}

/** Wraps a text label onto multiple short lines so it fits inside a bubble. */
function wrapBubbleLabel(text, maxLen = 15) {
    if (!text) return [''];
    const words = String(text).split(/\s+/);
    const lines = [];
    let current = '';
    words.forEach(word => {
        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length <= maxLen) {
            current = candidate;
        } else {
            if (current) lines.push(current);
            current = word;
        }
    });
    if (current) lines.push(current);
    return lines.length ? lines : [''];
}

/** Looks up a class's display text from the global registry, falling back to the raw id. */
function getRegistryLabel(id) {
    const entry = window.globalNodeRegistry ? window.globalNodeRegistry[id] : null;
    return entry && entry.text ? entry.text : id;
}

/**
 * Renders the "Relationship Map" bubble diagram (superclass / subclasses / properties)
 * for whichever class is passed in, into #bubble-diagram-svg-container. Mirrors the
 * look of the team's existing PyVis concept-map export: an orange "Selected Class"
 * hub in the middle, with superclasses, subclasses, and property targets arranged
 * around it and labeled edges (subclassOf, or the property name).
 */
function renderBubbleDiagram(nodeData) {
    const container = document.getElementById('bubble-diagram-svg-container');
    if (!container) return;
    container.innerHTML = '';

    if (!nodeData || nodeData.id === '__root__') {
        container.innerHTML = '<p class="bubble-empty-msg">Select a class in the tree above to see its superclasses, subclasses, and properties as a bubble map.</p>';
        return;
    }

    const meta = nodeData.meta || {};
    const centerLabel = nodeData.text || nodeData.id;

    // Build the list of satellite nodes (superclasses, subclasses, property targets),
    // deduplicated per role so the same class doesn't appear twice under one role.
    const satellites = [];
    const seen = new Set();
    const addSatellite = (id, role, color, size, edge) => {
        if (!id) return;
        const key = `${role}::${id}`;
        if (seen.has(key)) return;
        seen.add(key);
        satellites.push({ id, label: getRegistryLabel(id), role, color, size, edge });
    };

    (meta.superclasses || []).forEach(supId => {
        addSatellite(supId, 'Superclass', '#b0e0e6', 40,
            { direction: 'outgoing', label: 'subclassOf', dashed: true, color: '#999999' });
    });

    (meta.subclasses || []).forEach(subId => {
        addSatellite(subId, 'Subclass', '#aec6cf', 38,
            { direction: 'incoming', label: 'subclassOf', dashed: true, color: '#999999' });
    });

    const seenProps = new Set();
    (meta.slots || []).forEach(slot => {
        if (!slot || !slot.range) return;
        if (slot.type !== 'Object Property' && slot.type !== 'Data Property') return;
        const propKey = `${slot.name}::${slot.range}`;
        if (seenProps.has(propKey)) return;
        seenProps.add(propKey);
        addSatellite(slot.range, 'Class', '#aec6cf', 36,
            { direction: 'outgoing', label: slot.name, dashed: false, color: '#ff7f50' });
    });

    if (satellites.length === 0) {
        container.innerHTML = `<p class="bubble-empty-msg">"${centerLabel}" has no linked superclasses, subclasses, or properties to show.</p>`;
        return;
    }

    // Fixed radial layout (not force-directed) so the diagram is stable and readable.
    const width = Math.max(container.clientWidth || 900, 700);
    const centerRadius = 46;
    const ringRadius = Math.min(300, 120 + satellites.length * 14);
    const height = ringRadius * 2 + 160;
    const cx = width / 2;
    const cy = height / 2;

    const svg = d3.select(container).append('svg')
        .attr('width', '100%')
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('preserveAspectRatio', 'xMidYMid meet');

    svg.append('defs').append('marker')
        .attr('id', 'bubble-arrowhead')
        .attr('viewBox', '0 0 10 10')
        .attr('refX', 9)
        .attr('refY', 5)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto-start-reverse')
        .append('path')
        .attr('d', 'M0,0 L10,5 L0,10 Z')
        .attr('fill', '#999999');

    const positioned = satellites.map((sat, i) => {
        const angle = (i / satellites.length) * 2 * Math.PI - Math.PI / 2;
        return { ...sat, x: cx + ringRadius * Math.cos(angle), y: cy + ringRadius * Math.sin(angle) };
    });

    const linkLayer = svg.append('g').attr('class', 'bubble-links');
    const nodeLayer = svg.append('g').attr('class', 'bubble-nodes-layer');

    positioned.forEach(sat => {
        const outgoing = sat.edge.direction === 'outgoing'; // true: center -> satellite
        const [x1, y1, x2, y2] = outgoing ? [cx, cy, sat.x, sat.y] : [sat.x, sat.y, cx, cy];
        const startR = outgoing ? centerRadius : sat.size;
        const endR = outgoing ? sat.size : centerRadius;
        const dx = x2 - x1, dy = y2 - y1;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const sx = x1 + (dx / dist) * startR;
        const sy = y1 + (dy / dist) * startR;
        const ex = x2 - (dx / dist) * endR;
        const ey = y2 - (dy / dist) * endR;

        linkLayer.append('line')
            .attr('x1', sx).attr('y1', sy)
            .attr('x2', ex).attr('y2', ey)
            .attr('stroke', sat.edge.color)
            .attr('stroke-width', sat.edge.dashed ? 1.4 : 2)
            .attr('stroke-dasharray', sat.edge.dashed ? '5,4' : null)
            .attr('marker-end', 'url(#bubble-arrowhead)');

        linkLayer.append('text')
            .attr('class', 'bubble-link-label')
            .attr('x', (sx + ex) / 2)
            .attr('y', (sy + ey) / 2 - 5)
            .attr('text-anchor', 'middle')
            .text(sat.edge.label);
    });

    // Center "Selected Class" bubble
    const centerGroup = nodeLayer.append('g')
        .attr('class', 'bubble-node')
        .attr('transform', `translate(${cx},${cy})`);
    centerGroup.append('circle')
        .attr('r', centerRadius)
        .attr('fill', '#ffb347')
        .attr('stroke', '#e08e00');
    const centerLines = [...wrapBubbleLabel(centerLabel, 14), '(Selected Class)'];
    centerLines.forEach((line, i) => {
        centerGroup.append('text')
            .attr('y', (i - (centerLines.length - 1) / 2) * 13)
            .attr('font-weight', i === centerLines.length - 1 ? 'normal' : 'bold')
            .attr('font-style', i === centerLines.length - 1 ? 'italic' : 'normal')
            .text(line);
    });

    // Satellite bubbles — clicking one re-centers the diagram on that class.
    positioned.forEach(sat => {
        const group = nodeLayer.append('g')
            .attr('class', 'bubble-node')
            .attr('transform', `translate(${sat.x},${sat.y})`)
            .on('click', () => {
                const registryEntry = window.globalNodeRegistry ? window.globalNodeRegistry[sat.id] : null;
                if (registryEntry) {
                    renderBubbleDiagram({ id: registryEntry.id, text: registryEntry.text, meta: registryEntry.meta });
                }
            });
        group.append('circle')
            .attr('r', sat.size)
            .attr('fill', sat.color)
            .attr('stroke', '#6b8fa3');
        const lines = [...wrapBubbleLabel(sat.label, 14), `(${sat.role})`];
        lines.forEach((line, i) => {
            group.append('text')
                .attr('y', (i - (lines.length - 1) / 2) * 12)
                .attr('font-style', i === lines.length - 1 ? 'italic' : 'normal')
                .text(line);
        });
    });
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
            ? `Details of Class: "${d.data.text}"` 
            : 'Details of Class';
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

    // Refresh the relationship bubble diagram for this class.
    renderBubbleDiagram(d.data);
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
