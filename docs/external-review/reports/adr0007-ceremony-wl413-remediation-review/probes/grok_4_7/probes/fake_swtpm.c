/* Minimal listener whose argv can satisfy the rehearsal's comm/cmdline check. */
#include <arpa/inet.h>
#include <netinet/in.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char **argv) {
    int port = 2161;
    const char *logpath = "/home/user/workspace/council-wl413/grok_4_7/probes/fake-swtpm.log";
    for (int i = 1; i < argc - 1; i++) {
        if (strcmp(argv[i], "--server") == 0) {
            char *p = strstr(argv[i + 1], "port=");
            if (p) port = atoi(p + 5);
        }
    }
    int s = socket(AF_INET, SOCK_STREAM, 0);
    if (s < 0) return 2;
    int one = 1;
    setsockopt(s, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));
    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons((unsigned short)port);
    inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);
    if (bind(s, (struct sockaddr *)&addr, sizeof(addr)) < 0) return 3;
    if (listen(s, 1) < 0) return 4;
    FILE *lg = fopen(logpath, "w");
    if (lg) { fprintf(lg, "listening %d\n", port); fclose(lg); }
    int c = accept(s, NULL, NULL);
    if (c < 0) return 5;
    unsigned char buf[8192];
    int n = read(c, buf, sizeof(buf));
    lg = fopen(logpath, "a");
    if (lg) {
        fprintf(lg, "bytes=%d\n", n);
        for (int i = 0; i < n && i < 64; i++) fprintf(lg, "%02x", buf[i]);
        if (n > 0) fprintf(lg, "\n");
        fclose(lg);
    }
    unsigned char resp[10] = {0x80, 0x01, 0, 0, 0, 10, 0, 0, 0, 1};
    write(c, resp, 10);
    close(c);
    close(s);
    return 0;
}
