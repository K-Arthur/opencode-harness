
const MarkdownIt = require('markdown-it');
const md = new MarkdownIt();
const table = `
| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
`;
console.log(md.render(table));
