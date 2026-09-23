import { interactive_tree } from './tree-reusable-d3.js';
import { ontologyData } from './ontology-data.js';

// 1. Create the tree instance
const myTree = interactive_tree();

// 2. Render it inside your container
d3.select("#tree-container").call(myTree);

// 3. Pass the JavaScript object directly using .data() instead of .data_url()
myTree.data(ontologyData);
