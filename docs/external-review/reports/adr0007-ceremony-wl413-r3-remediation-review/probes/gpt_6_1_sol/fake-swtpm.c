#include <sys/socket.h>
#include <netinet/in.h>
#include <sys/prctl.h>
#include <unistd.h>
#include <stdio.h>
#include <string.h>
int main(int argc,char **argv){
  (void)argc;(void)argv;
  prctl(PR_SET_NAME,"swtpm",0,0,0);
  int fd=socket(AF_INET,SOCK_STREAM,0),reuse=1;
  setsockopt(fd,SOL_SOCKET,SO_REUSEADDR,&reuse,sizeof(reuse));
  struct sockaddr_in a;memset(&a,0,sizeof(a));a.sin_family=AF_INET;a.sin_addr.s_addr=htonl(INADDR_LOOPBACK);a.sin_port=htons(5600);
  if(bind(fd,(void*)&a,sizeof(a))||listen(fd,2)){perror("bind/listen");return 2;}
  fprintf(stdout,"listening 127.0.0.1:5600\n");fflush(stdout);
  int client=accept(fd,0,0);
  if(client>=0){unsigned char b[65536];ssize_t n=read(client,b,sizeof(b));fprintf(stdout,"received=%ld\n",(long)n);fflush(stdout);close(client);}
  close(fd);return 0;
}
