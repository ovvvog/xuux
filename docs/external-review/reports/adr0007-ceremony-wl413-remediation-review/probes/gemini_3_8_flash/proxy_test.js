const net = require('net');
const server = net.createServer((c) => {
    const upstream = net.connect(2111, '127.0.0.1');
    c.pipe(upstream);
    upstream.pipe(c);
});
server.listen(3150, '127.0.0.1', () => {
    console.log('PROXY_READY');
});