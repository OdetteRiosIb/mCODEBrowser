import { interactive_tree } from './edam-tree-reusable-d3.js';
import { ontologyData } from './ontology-data.js';

/**
 * Initialize and render the ontology tree
 */
export function initOntologyTree() {
    // 1. Create the tree instance
    const myTree = interactive_tree();

    // 2. Render it inside your correct container ID
    d3.select("#ontology-tree-container").call(myTree);

    // 3. Pass the JavaScript data object
    myTree.data(ontologyData);
    
    console.log("Ontology tree initialized successfully.");
}

// Automatically trigger it when this module loads (if you aren't calling it from a master file)
initOntologyTree();
