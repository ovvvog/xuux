// WL-414 دورةُ المعالجةِ — نسخةُ السياقِ (للشيفرةِ المعدّلةِ فقط) من مسبارِ قياسٍ لشكلِ ردِّ PolicySigned الحقيقيِّ على swtpm (لا تعديلَ للنواة).
// لكلِّ (نوعِ جلسةٍ × expiration): يطبعُ طولَ timeout ووسمَ التذكرةِ وهرميّتَها وطولَ بصمتِها، ثمّ حكمَ ResponseSchema.Check.
using System;
using Xuux.TpmCeremony;
public static class TicketShapeCtx {
    static uint U32(byte[] b,int o){return ((uint)b[o]<<24)|((uint)b[o+1]<<16)|((uint)b[o+2]<<8)|b[o+3];}
    static byte[] Slice(byte[] b,int o,int n){byte[] r=new byte[n];Array.Copy(b,o,r,0,n);return r;}
    static ResponseContext Ctx=new ResponseContext();
    static int HC(uint cc){return cc==Tpm.CC_CreatePrimary||cc==Tpm.CC_Load?1:cc==Tpm.CC_StartAuthSession?1:0;}
    static byte[] Send(ICeremonyTransport t,byte[] c){byte[] r=t.Transmit(c);if(U32(r,6)!=0)throw new Exception("TPM rc="+Hex.U32(U32(r,6)));uint cc=U32(c,6);int n=HC(cc);uint[] hs=new uint[n];for(int i=0;i<n;i++)hs[i]=U32(r,10+4*i);Ctx.Record(cc,c,hs,Params(r,n));return r;}
    static byte[] Params(byte[] r,int h){int o=10+4*h;if(r[1]==2)return Slice(r,o+4,(int)U32(r,o));return Slice(r,o,r.Length-o);}
    public static int Main(string[] a){
        int port=int.Parse(a[0]);
        using(SwtpmLoopbackTransport t=new SwtpmLoopbackTransport("127.0.0.1",port)){
            uint primary=U32(Send(t,Cmd.CreatePrimary(new byte[0],Templates.StoragePrimary())),10);
            Rd c=new Rd(Params(Send(t,Cmd.Create(primary,new byte[0],Templates.ServiceSigningKey())),0));
            byte[] priv=c.B2B(),pub=c.B2B();
            uint key=U32(Send(t,Cmd.Load(primary,new byte[0],priv,pub)),10);
            foreach(byte st in new byte[]{Tpm.SE_POLICY,Tpm.SE_TRIAL})
            foreach(int exp in new int[]{0,3600,-3600}){
                byte[] sr=Send(t,Cmd.StartAuthSession(st,new byte[32]));
                uint session=U32(sr,10);byte[] nonce=new Rd(Params(sr,1)).B2B();
                Rd sig=new Rd(Params(Send(t,Cmd.Sign(key,new byte[0],Policy.AHash(nonce,exp))),0));
                sig.U16();sig.U16();byte[] r=sig.B2B(),s=sig.B2B();
                byte[] cmd=Cmd.PolicySigned(key,session,nonce,exp,r,s);
                byte[] reply=t.Transmit(cmd);uint rc=U32(reply,6);
                string line="session="+(st==Tpm.SE_POLICY?"policy":"trial")+" expiration="+exp+" rc="+Hex.U32(rc);
                if(rc==0){
                    byte[] p=Params(reply,0);Rd q=new Rd(p);byte[] to=q.B2B();ushort tag=q.U16();uint h=q.U32();byte[] td=q.B2B();
                    line+=" timeoutLen="+to.Length+" tag=0x"+tag.ToString("x4")+" hierarchy="+Hex.U32(h)+" digestLen="+td.Length+" raw="+Hex.Of(p);
                    try{ResponseSchema.Check(Tpm.CC_PolicySigned,cmd,p,Ctx);line+=" SCHEMA_ACCEPT";}catch(Exception e){line+=" SCHEMA_REJECT "+e.Message;}
                }
                Console.WriteLine(line);
                Send(t,Cmd.FlushContext(session));
            }
            Send(t,Cmd.FlushContext(key));Send(t,Cmd.FlushContext(primary));
        }
        return 0;
    }
}
