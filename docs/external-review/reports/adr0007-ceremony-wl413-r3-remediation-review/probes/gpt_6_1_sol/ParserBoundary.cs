using System;
using Xuux.TpmCeremony;
public static class ParserBoundary
{
    private static void Case(string name,Action action)
    {
        try {action();Console.WriteLine(name+": accepted");}
        catch(Exception e){Console.WriteLine(name+": "+e.GetType().Name+": "+e.Message);}
    }
    public static int Main()
    {
        Case("parameterSize-ffffffff",delegate {
            byte[] raw=new Wr().U16(Tpm.ST_SESSIONS).U32(19).U32(0).U32(UInt32.MaxValue).Raw(new byte[5]).Bytes();
            Resp.Parse(raw,0,Tpm.ST_SESSIONS,1);
        });
        Case("parameterSize-80000000",delegate {
            byte[] raw=new Wr().U16(Tpm.ST_SESSIONS).U32(19).U32(0).U32(0x80000000).Raw(new byte[5]).Bytes();
            Resp.Parse(raw,0,Tpm.ST_SESSIONS,1);
        });
        Case("capability-more-than-requested",delegate {
            Wr p=new Wr().U8(0).U32(1).U32(65);
            for(uint i=0;i<65;i++)p.U32(0x01800000+i);
            ResponseSchema.Check(Tpm.CC_GetCapability,Cmd.GetCapability(1,0x01000000,64),p.Bytes());
        });
        Case("capability-below-requested",delegate {
            ResponseSchema.Check(Tpm.CC_GetCapability,Cmd.GetCapability(1,0x01800010,64),new Wr().U8(0).U32(1).U32(1).U32(0x01800001).Bytes());
        });
        Case("capability-duplicate",delegate {
            ResponseSchema.Check(Tpm.CC_GetCapability,Cmd.GetCapability(1,0x01000000,64),new Wr().U8(0).U32(1).U32(2).U32(0x01800001).U32(0x01800001).Bytes());
        });
        Case("capability-descending",delegate {
            ResponseSchema.Check(Tpm.CC_GetCapability,Cmd.GetCapability(1,0x01000000,64),new Wr().U8(0).U32(1).U32(2).U32(0x01800002).U32(0x01800001).Bytes());
        });
        Case("malformed-18b-tag",delegate {
            Resp.Parse(new Wr().U16(0x1234).U32(10).U32(0x18b).Bytes(),0,Tpm.ST_NO_SESSIONS,0);
        });
        Case("malformed-14a-body",delegate {
            Resp.Parse(new Wr().U16(Tpm.ST_NO_SESSIONS).U32(11).U32(0x14a).U8(0).Bytes(),0,Tpm.ST_SESSIONS,1);
        });
        return 0;
    }
}
