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
 *
 * Classes with a huge fan-out (e.g. "Histologic Type" with hundreds of subclasses)
 * are capped per category (MAX_PER_ROLE) so bubbles never overlap into an
 * unreadable ring; the rest collapse into a single "+N more" bubble that opens a
 * scrollable, clickable list underneath the diagram.
 */
const MAX_SATELLITES_PER_ROLE = 12;

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

    // 1. Collect deduplicated ids per role first, so we can decide what to cap
    //    before ever building a satellite/bubble for them.
    const superclassIds = [...new Set(meta.superclasses || [])];
    const subclassIds = [...new Set(meta.subclasses || [])];

    const propSeen = new Set();
    const propertyEntries = [];
    (meta.slots || []).forEach(slot => {
        if (!slot || !slot.range) return;
        if (slot.type !== 'Object Property' && slot.type !== 'Data Property') return;
        const key = `${slot.name}::${slot.range}`;
        if (propSeen.has(key)) return;
        propSeen.add(key);
        propertyEntries.push(slot);
    });

    // 2. Cap each role to MAX_SATELLITES_PER_ROLE, tracking how many were left out.
    const cappedSuperclasses = superclassIds.slice(0, MAX_SATELLITES_PER_ROLE);
    const overflowSuperclasses = superclassIds.slice(MAX_SATELLITES_PER_ROLE);
    const cappedSubclasses = subclassIds.slice(0, MAX_SATELLITES_PER_ROLE);
    const overflowSubclasses = subclassIds.slice(MAX_SATELLITES_PER_ROLE);
    const cappedProperties = propertyEntries.slice(0, MAX_SATELLITES_PER_ROLE);
    const overflowProperties = propertyEntries.slice(MAX_SATELLITES_PER_ROLE);

    // 3. Build the satellite bubble list (plus one "+N more" bubble per role that overflowed).
    const satellites = [];

    cappedSuperclasses.forEach(supId => {
        satellites.push({
            id: supId, label: getRegistryLabel(supId), role: 'Superclass',
            color: '#b2f5f7', size: 40,
            edge: { direction: 'outgoing', label: 'subclassOf', dashed: true, color: '#999999' }
        });
    });
    if (overflowSuperclasses.length) {
        satellites.push({
            id: null, label: `+${overflowSuperclasses.length} more`, role: 'Superclass', isOverflow: true,
            overflowIds: overflowSuperclasses, color: '#e2e8f0', size: 34,
            edge: { direction: 'outgoing', label: 'subclassOf', dashed: true, color: '#999999' }
        });
    }

    cappedSubclasses.forEach(subId => {
        satellites.push({
            id: subId, label: getRegistryLabel(subId), role: 'Subclass',
            color: '#c2ffce', size: 38,
            edge: { direction: 'incoming', label: 'subclassOf', dashed: true, color: '#999999' }
        });
    });
    if (overflowSubclasses.length) {
        satellites.push({
            id: null, label: `+${overflowSubclasses.length} more`, role: 'Subclass', isOverflow: true,
            overflowIds: overflowSubclasses, color: '#e2e8f0', size: 34,
            edge: { direction: 'incoming', label: 'subclassOf', dashed: true, color: '#999999' }
        });
    }

    cappedProperties.forEach(slot => {
        satellites.push({
            id: slot.range, label: getRegistryLabel(slot.range), role: 'Class',
            color: '#e3cfff', size: 36,
            edge: { direction: 'outgoing', label: slot.name, dashed: false, color: '#02bac7' }
        });
    });
    if (overflowProperties.length) {
        satellites.push({
            id: null, label: `+${overflowProperties.length} more`, role: 'Class', isOverflow: true,
            overflowProps: overflowProperties, color: '#e2e8f0', size: 34,
            edge: { direction: 'outgoing', label: 'relatesTo', dashed: false, color: '#02bac7' }
        });
    }

    if (satellites.length === 0) {
        container.innerHTML = `<p class="bubble-empty-msg">"${centerLabel}" has no linked superclasses, subclasses, or properties to show.</p>`;
        return;
    }

    // 4. Size the ring so bubbles are always evenly spaced with no overlap, however
    //    many satellites are being shown (bounded above by the caps, so this stays sane).
    const width = Math.max(container.clientWidth || 900, 700);
    const centerRadius = 46;
    const avgSatelliteSpan = 92; // rough bubble diameter + gap, in px
    const minRingForSpacing = (satellites.length * avgSatelliteSpan) / (2 * Math.PI);
    const ringRadius = Math.max(160, minRingForSpacing);
    const height = ringRadius * 2 + 170;
    const cx = width / 2;
    const cy = height / 2;

    const svg = d3.select(container).append('svg')
        .attr('width', '100%')
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .style('cursor', 'grab');

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

    // Everything pannable/zoomable lives inside zoomLayer, so dense diagrams stay
    // fully explorable even when the fit-to-width view shrinks the labels.
    const zoomLayer = svg.append('g').attr('class', 'bubble-zoom-layer');
    const linkLayer = zoomLayer.append('g').attr('class', 'bubble-links');
    const nodeLayer = zoomLayer.append('g').attr('class', 'bubble-nodes-layer');

    svg.call(
        d3.zoom()
            .scaleExtent([0.4, 4])
            .on('zoom', (event) => zoomLayer.attr('transform', event.transform))
            .on('start', () => svg.style('cursor', 'grabbing'))
            .on('end', () => svg.style('cursor', 'grab'))
    );

    const positioned = satellites.map((sat, i) => {
        const angle = (i / satellites.length) * 2 * Math.PI - Math.PI / 2;
        return { ...sat, x: cx + ringRadius * Math.cos(angle), y: cy + ringRadius * Math.sin(angle) };
    });

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
            .attr('marker-end', sat.isOverflow ? null : 'url(#bubble-arrowhead)');

        if (!sat.isOverflow) {
            linkLayer.append('text')
                .attr('class', 'bubble-link-label')
                .attr('x', (sx + ex) / 2)
                .attr('y', (sy + ey) / 2 - 5)
                .attr('text-anchor', 'middle')
                .text(sat.edge.label);
        }
    });

    // Center "Selected Class" bubble
    const centerGroup = nodeLayer.append('g')
        .attr('class', 'bubble-node')
        .attr('transform', `translate(${cx},${cy})`);
    centerGroup.append('circle')
        .attr('r', centerRadius)
        .attr('fill', '#87c5ff')
        .attr('stroke', '#02bac7');
    const centerLines = [...wrapBubbleLabel(centerLabel, 14), '(Selected Class)'];
    centerLines.forEach((line, i) => {
        centerGroup.append('text')
            .attr('y', (i - (centerLines.length - 1) / 2) * 13)
            .attr('font-weight', i === centerLines.length - 1 ? 'normal' : 'bold')
            .attr('font-style', i === centerLines.length - 1 ? 'italic' : 'normal')
            .text(line);
    });

    // Satellite bubbles — clicking a real one re-centers the diagram + Details card on
    // that class; clicking a "+N more" bubble reveals the rest as a clickable list below.
    positioned.forEach(sat => {
        const group = nodeLayer.append('g')
            .attr('class', 'bubble-node')
            .attr('transform', `translate(${sat.x},${sat.y})`)
            .style('stroke-dasharray', sat.isOverflow ? '4,3' : null)
            .on('click', () => {
                if (sat.isOverflow) {
                    showBubbleOverflowList(sat, nodeData);
                    return;
                }
                const registryEntry = window.globalNodeRegistry ? window.globalNodeRegistry[sat.id] : null;
                if (registryEntry) {
                    // Route through showNodeDetails (not just renderBubbleDiagram) so the
                    // Details-of-Class card, tree selection highlight, and bubble map all
                    // stay in sync with whichever bubble was clicked.
                    showNodeDetails({ data: registryEntry });
                }
            });
        group.append('circle')
            .attr('r', sat.size)
            .attr('fill', sat.color)
            .attr('stroke', sat.isOverflow ? '#94a3b8' : '#6b8fa3')
            .attr('stroke-dasharray', sat.isOverflow ? '4,3' : null);
        const lines = sat.isOverflow
            ? [...wrapBubbleLabel(sat.label, 14)]
            : [...wrapBubbleLabel(sat.label, 14), `(${sat.role})`];
        lines.forEach((line, i) => {
            group.append('text')
                .attr('y', (i - (lines.length - 1) / 2) * 12)
                .attr('font-style', (!sat.isOverflow && i === lines.length - 1) ? 'italic' : 'normal')
                .text(line);
        });
    });
}

/**
 * Renders a scrollable, clickable list of whichever ids/properties got capped out
 * of the bubble diagram, directly under the SVG — so nothing is ever truly hidden,
 * just tucked one click away.
 */
function showBubbleOverflowList(overflowSat, centerNodeData) {
    const container = document.getElementById('bubble-diagram-svg-container');
    if (!container) return;

    let listBox = document.getElementById('bubble-overflow-list');
    if (listBox) listBox.remove();

    listBox = document.createElement('div');
    listBox.id = 'bubble-overflow-list';
    listBox.className = 'bubble-overflow-list';

    const heading = document.createElement('div');
    heading.className = 'bubble-overflow-heading';
    heading.textContent = overflowSat.overflowProps
        ? `Remaining ${overflowSat.overflowProps.length} properties`
        : `Remaining ${overflowSat.role.toLowerCase()}es`.replace('Classes', 'classes');
    listBox.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'bubble-overflow-items';

    if (overflowSat.overflowProps) {
        overflowSat.overflowProps.forEach(slot => {
            const item = document.createElement('span');
            item.className = 'value-link bubble-overflow-item';
            item.textContent = `${slot.name} → ${getRegistryLabel(slot.range)}`;
            item.addEventListener('click', () => {
                const registryEntry = window.globalNodeRegistry ? window.globalNodeRegistry[slot.range] : null;
                if (registryEntry) showNodeDetails({ data: registryEntry });
            });
            list.appendChild(item);
        });
    } else {
        (overflowSat.overflowIds || []).forEach(id => {
            const item = document.createElement('span');
            item.className = 'value-link bubble-overflow-item';
            item.textContent = getRegistryLabel(id);
            item.addEventListener('click', () => {
                const registryEntry = window.globalNodeRegistry ? window.globalNodeRegistry[id] : null;
                if (registryEntry) showNodeDetails({ data: registryEntry });
            });
            list.appendChild(item);
        });
    }

    listBox.appendChild(list);
    container.appendChild(listBox);
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
