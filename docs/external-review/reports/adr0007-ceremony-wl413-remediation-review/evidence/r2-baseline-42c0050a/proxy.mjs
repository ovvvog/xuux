// وسيطٌ محلّيٌّ على loopback يمرّرُ البايتاتِ إلى swtpm — يمثّلُ «نقلًا غيرَ المحاكي» خلفَ منفذٍ مقبول.
import net from 'node:net';
const [listen, target] = process.argv.slice(2).map(Number);
let n = 0;
net.createServer((c) => { const s = net.connect(target, '127.0.0.1'); c.on('data', (d) => { n++; s.write(d); }); s.pipe(c); c.on('close', () => { s.destroy(); console.error('proxied-commands=' + n); }); }).listen(listen, '127.0.0.1');
