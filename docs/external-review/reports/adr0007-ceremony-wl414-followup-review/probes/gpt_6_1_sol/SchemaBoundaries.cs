// Standalone parser probes: no network transport at all.
using System;
using Xuux.TpmCeremony;
public static class SchemaBoundaries {
    private static void Check(string name,uint cc,byte[] cmd,byte[] prm) {
        try {ResponseSchema.Check(cc,cmd,prm);Console.WriteLine(name+" ACCEPT");}
        catch(Exception e) {Console.WriteLine(name+" REJECT "+e.GetType().Name+": "+e.Message);}
    }
    public static int Main() {
        byte[] zero=new byte[0],nonce=new byte[32];
        foreach(int exp in new int[]{-1,0,1,3600}) {
            byte[] cmd=Cmd.PolicySigned(0x80000001,0x03000000,nonce,exp,new byte[32],new byte[32]);
            foreach(int len in new int[]{0,1,32,64,65}) {
                byte[] prm=new Wr().B2B(zero).U16(0x8025).U32(Tpm.RH_NULL).B2B(new byte[len]).Bytes();
                Check("PolicySigned expiration="+exp+" NULL digest="+len,Tpm.CC_PolicySigned,cmd,prm);
            }
        }
        foreach(uint start in new uint[]{0x01000010,0x02000010,0x80000010}) {
            foreach(int count in new int[]{1,64,65}) {
                Wr w=new Wr().U8(0).U32(1).U32((uint)count);
                for(int i=0;i<count;i++)w.U32(start+(uint)i);
                Check("GetCapability start="+Hex.U32(start)+" count="+count,Tpm.CC_GetCapability,Cmd.GetCapability(1,start,64),w.Bytes());
            }
            Check("GetCapability below start="+Hex.U32(start),Tpm.CC_GetCapability,Cmd.GetCapability(1,start,64),new Wr().U8(0).U32(1).U32(1).U32(start-1).Bytes());
        }
        return 0;
    }
}
