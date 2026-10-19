// Genuine swtpm reply for positive PolicySigned expiration, without modifying core.
using System;
using Xuux.TpmCeremony;
public static class PositiveExpiration {
    private static byte[] Send(ICeremonyTransport t,byte[] c) {
        Console.WriteLine("request="+Hex.Of(c));byte[] r=t.Transmit(c);Console.WriteLine("response="+Hex.Of(r));
        if(FollowupTransport.U32(r,6)!=0)throw new Exception("TPM rc="+Hex.U32(FollowupTransport.U32(r,6)));
        return r;
    }
    private static byte[] Parameters(byte[] r,int handles) {
        int o=10+4*handles;
        if(r[1]==2)return FollowupTransport.Slice(r,o+4,(int)FollowupTransport.U32(r,o));
        return FollowupTransport.Slice(r,o,r.Length-o);
    }
    public static int Main(string[] args) {
        int expiration=int.Parse(args[0]);
        using(SwtpmLoopbackTransport t=new SwtpmLoopbackTransport("127.0.0.1",7100)) {
            uint primary=FollowupTransport.U32(Send(t,Cmd.CreatePrimary(new byte[0],Templates.StoragePrimary())),10);
            Rd c=new Rd(Parameters(Send(t,Cmd.Create(primary,new byte[0],Templates.ServiceSigningKey())),0));
            byte[] priv=c.B2B(),pub=c.B2B();
            uint key=FollowupTransport.U32(Send(t,Cmd.Load(primary,new byte[0],priv,pub)),10);
            byte[] sessionReply=Send(t,Cmd.StartAuthSession(Tpm.SE_POLICY,new byte[32]));
            uint session=FollowupTransport.U32(sessionReply,10);
            byte[] nonce=new Rd(Parameters(sessionReply,1)).B2B();
            Rd sig=new Rd(Parameters(Send(t,Cmd.Sign(key,new byte[0],Policy.AHash(nonce,expiration))),0));
            sig.U16();sig.U16();byte[] r=sig.B2B(),s=sig.B2B();
            byte[] cmd=Cmd.PolicySigned(key,session,nonce,expiration,r,s);
            byte[] reply=Send(t,cmd);
            try {ResponseSchema.Check(Tpm.CC_PolicySigned,cmd,Parameters(reply,0));Console.WriteLine("expiration="+expiration+" SCHEMA_ACCEPT");}
            catch(Exception e){Console.WriteLine("expiration="+expiration+" SCHEMA_REJECT "+e.GetType().Name+": "+e.Message);}
            Send(t,Cmd.FlushContext(session));Send(t,Cmd.FlushContext(key));Send(t,Cmd.FlushContext(primary));
        }
        return 0;
    }
}
