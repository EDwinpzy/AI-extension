import fs from 'node:fs';
let html = fs.readFileSync('translate/options.html', 'utf8');
html = html.replace(/<p class="desc">[^<]*<\/p>\s*/g, '');
html = html.replace(/<p class="note">[^<]*<\/p>\s*/g, '');
html = html.replace(/<p class="bm-meta bm-taxonomy"[^>]*>[\s\S]*?<\/p>\s*/g, '');
html = html.replace(/<div class="label">\s*<b>([^<]+)<\/b>\s*<span>[^<]*<\/span>\s*<\/div>/g, '<div class="label"><b>$1</b></div>');
fs.writeFileSync('translate/options.html', html);
console.log('done, remaining desc:', (html.match(/class="desc"/g) || []).length, 'note:', (html.match(/class="note"/g) || []).length, 'spans in label:', (html.match(/<div class="label"><b>[^<]*<\/b><span>/g) || []).length);
