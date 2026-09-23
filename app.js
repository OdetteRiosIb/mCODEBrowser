import { interactive_tree } from './tree-reusable-d3.js';

// 1. Create the tree instance
const myTree = interactive_tree();

// 2. Select the DOM element where the tree should render and pass the chart
d3.select("#tree-container").call(myTree);

// 3. Provide your EDAM JSON data URL to load the tree
myTree.data_url("path/to/your/edam-data.json");
