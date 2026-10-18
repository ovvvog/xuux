using System;
using System.Collections.Generic;
using System.IO;
using Xuux.TpmCeremony;

public sealed class IndependentR3Transport : ICeremonyTransport
{
    public string Kind { get { return "independent-r3-on-private-swtpm"; } }
    private readonly ICeremonyTransport inner;
    public readonly string Mode;
    public int Changes;
    public readonly List<string> Edits = new List<string>();
    public readonly List<uint> Sentinels = new List<uint>();
    public readonly List<uint> Flushed = new List<uint>();
    private int starts, loads, creates, undefines;
    private bool baselineEdited;
    private bool cleanupTriggered;

    public static uint U32(byte[] b, int i) { return ((uint)b[i]<<24)|((uint)b[i+1]<<16)|((uint)b[i+2]<<8)|b[i+3]; }
    public static ushort U16(byte[] b, int i) { return (ushort)((b[i]<<8)|b[i+1]); }
    public static void Put32(byte[] b, int i, uint u) { b[i]=(byte)(u>>24);b[i+1]=(byte)(u>>16);b[i+2]=(byte)(u>>8);b[i+3]=(byte)u; }
    public static int Handles(uint cc) { return cc==Tpm.CC_CreatePrimary || cc==Tpm.CC_Load || cc==Tpm.CC_StartAuthSession ? 1 : 0; }
    public IndependentR3Transport(ICeremonyTransport t, string mode)
    {
        inner=t; Mode=mode;
        if (mode=="primary-alias" || mode=="inventory-duplicate-alias") {
            int n=mode=="primary-alias"?1:2;
            for(int i=0;i<n;i++) {
                byte[] raw=inner.Transmit(Cmd.CreatePrimary(new byte[0],Templates.StoragePrimary()));
                if(U32(raw,6)!=0) throw new Exception("sentinel create error");
                Sentinels.Add(U32(raw,10));
            }
        }
    }
    public static string ListJson(IEnumerable<uint> hs) { List<string> x=new List<string>();foreach(uint h in hs)x.Add("\""+Hex.U32(h)+"\"");return "["+String.Join(",",x.ToArray())+"]"; }
    public static List<uint> Inventory(ICeremonyTransport t,uint start)
    {
        List<uint> x=new List<uint>();uint next=start;
        for(int page=0;page<16;page++){
            byte[] raw=t.Transmit(Cmd.GetCapability(1,next,64));
            if(U32(raw,6)!=0)throw new Exception("inventory error");
            Rd r=new Rd(Sub(raw,10,raw.Length-10));byte more=r.U8();r.U32();uint n=r.U32(),last=0;
            for(uint i=0;i<n;i++){last=r.U32();x.Add(last);}
            if(more==0)return x;if(n==0)throw new Exception("inventory stuck");next=last+1;
        }throw new Exception("inventory pages");
    }
    public static byte[] Sub(byte[] b,int start,int count) { byte[] n=new byte[count];Buffer.BlockCopy(b,start,n,0,count);return n; }
    private byte[] Rewrite(byte[] raw,uint cc,Func<byte[],byte[]> f,bool auth)
    {
        ushort tag=U16(raw,0);int h=Handles(cc);
        int pos=10+4*h;
        byte[] handles=Sub(raw,10,4*h),prm,area;
        if(tag==Tpm.ST_SESSIONS){int n=(int)U32(raw,pos);prm=Sub(raw,pos+4,n);area=Sub(raw,pos+4+n,raw.Length-pos-4-n);}
        else {prm=Sub(raw,pos,raw.Length-pos);area=new byte[0];}
        byte[] old=auth?area:prm;
        string oldHex=Hex.Of(old);
        byte[] edited=f(old);
        Edits.Add(cc.ToString("x8")+":tag="+tag.ToString("x4")+":"+(auth?"auth":"params")+":"+oldHex+"=>"+Hex.Of(edited));
        if(auth)area=edited;else prm=edited;
        Wr body=new Wr().Raw(handles);
        if(tag==Tpm.ST_SESSIONS)body.U32((uint)prm.Length);
        body.Raw(prm).Raw(area);
        byte[] b=body.Bytes();Changes++;
        return new Wr().U16(tag).U32((uint)(10+b.Length)).U32(0).Raw(b).Bytes();
    }
    private byte[] Creation(byte[] p,uint cc)
    {
        Rd r=new Rd(p);byte[] priv=cc==Tpm.CC_Create?r.B2B():null;
        byte[] pub=r.B2B(),cd=r.B2B(),ch=r.B2B();ushort tag=r.U16();uint hierarchy=r.U32();byte[] digest=r.B2B();byte[] rest=r.Raw(r.Remaining);
        if(Mode=="cd-missing")cd=Sub(cd,0,41);
        if(Mode=="cd-extra")cd=new Wr().Raw(cd).B2B(new byte[0]).Bytes();
        if(Mode=="cd-parentalg"){cd[39]=255;cd[40]=255;}
        if(Mode=="cd-locality")cd[38]=255;
        if(Mode=="cd-empty-pcr-digest") {
            Rd d=new Rd(cd);uint count=d.U32();
            if(count!=0)throw new Exception("expected empty pcrSelect in source response");
            d.B2B();
            cd=new Wr().U32(0).B2B(new byte[0]).Raw(d.Raw(d.Remaining)).Bytes();
            ch=Sha.H(cd);
        }
        if(Mode=="create-cd-missing")cd=Sub(cd,0,41);
        if(Mode=="creationhash-flip")ch[0]^=1;
        if(Mode=="creation-ticket-hierarchy")hierarchy=0x40000002;
        if(Mode=="creation-ticket-digest")digest=new byte[65];
        if(Mode=="primary-name-flip")rest[rest.Length-1]^=1;
        Wr w=new Wr();if(priv!=null)w.B2B(priv);
        return w.B2B(pub).B2B(cd).B2B(ch).U16(tag).U32(hierarchy).B2B(digest).Raw(rest).Bytes();
    }
    public byte[] Transmit(byte[] cmd)
    {
        uint cc=U32(cmd,6);
        if(Mode=="same-public-foreign" && cc==Tpm.CC_NV_DefineSpace && Changes==0) {
            Rd c=new Rd(cmd);c.Raw(14);uint az=c.U32();c.Raw((int)az);c.B2B();byte[] pub=c.B2B();
            byte[] planted=inner.Transmit(Cmd.NvDefineSpace(new byte[0],new byte[]{0x11},pub));
            byte[] original=inner.Transmit(cmd);
            Changes++;Edits.Add("foreign identical public planted rc="+Hex.U32(U32(planted,6))+"; original define rc="+Hex.U32(U32(original,6))+" discarded");
            throw new IOException("INDEPENDENT_FOREIGN_IDENTICAL_DEFINITION_AND_LOST_ORIGINAL_REPLY");
        }
        if(Mode=="same-public-foreign" && cc==Tpm.CC_NV_UndefineSpace)
            Edits.Add("NV_UndefineSpace forwarded for "+Hex.U32(U32(cmd,14)));
        if(Mode=="cleanup-undefine-loss" && cc==Tpm.CC_NV_ReadPublic && !cleanupTriggered) {
            cleanupTriggered=true;throw new CeremonyFailedException("INDEPENDENT_FORCE_CLEANUP",0);
        }
        if(Mode=="cleanup-undefine-loss" && cc==Tpm.CC_NV_UndefineSpace) {
            Changes++;Edits.Add("cleanup NV_UndefineSpace not forwarded");throw new IOException("INDEPENDENT_CLEANUP_DROP");
        }
        if(cc==Tpm.CC_FlushContext)Flushed.Add(U32(cmd,10));
        byte[] raw=inner.Transmit(cmd);
        if(U32(raw,6)!=0)return raw;
        if(cc==Tpm.CC_StartAuthSession)starts++;
        if(cc==Tpm.CC_Load)loads++;
        if(cc==Tpm.CC_CreatePrimary)creates++;
        if(cc==Tpm.CC_NV_UndefineSpace)undefines++;
        if(Mode=="create-loss-proof" && cc==Tpm.CC_Create && Changes==0) {
            Changes++;Edits.Add("Create actual responseCode=0; response discarded after execution");
            throw new IOException("INDEPENDENT_CREATE_SUCCESS_RESPONSE_DISCARDED");
        }
        if(Mode.StartsWith("post-inventory-") && undefines==2 && cc==Tpm.CC_GetCapability && U32(cmd,10)==1 && U32(cmd,14)==0x01000000 && Changes==0)
            return Rewrite(raw,cc,delegate(byte[] p){
                if(Mode=="post-inventory-no-progress")return new Wr().U8(1).U32(1).U32(0).Bytes();
                return new Wr().U8(1).U32(1).U32(1).U32(0x80000001).Bytes();
            },false);
        if(Mode=="inventory-duplicate-alias" && cc==Tpm.CC_GetCapability && U32(cmd,10)==1 && U32(cmd,14)==0x80000000 && !baselineEdited){
            baselineEdited=true;
            return Rewrite(raw,cc,delegate(byte[] p){return new Wr().U8(0).U32(1).U32(2).U32(Sentinels[0]).U32(Sentinels[0]).Bytes();},false);
        }
        if((Mode=="primary-alias" || Mode=="inventory-duplicate-alias") && cc==Tpm.CC_CreatePrimary && creates==1) {
            uint h=Sentinels[Sentinels.Count-1];uint actual=U32(raw,10);Put32(raw,10,h);Changes++;
            Edits.Add("primary-handle:"+Hex.U32(actual)+"=>"+Hex.U32(h));return raw;
        }
        if(Mode=="baseline-transient-badclass" && cc==Tpm.CC_GetCapability && U32(cmd,10)==1 && U32(cmd,14)==0x80000000 && Changes==0)
            return Rewrite(raw,cc,delegate(byte[] p){return new Wr().U8(0).U32(1).U32(1).U32(0x01000001).Bytes();},false);
        if(Changes>0)return raw;
        if(Mode.StartsWith("auth-pw-") && cc==Tpm.CC_NV_DefineSpace) {
            int n=Mode=="auth-pw-nonce16"?16:Mode=="auth-pw-nonce64"?64:32;
            byte attrs=Mode=="auth-pw-reserved3"?(byte)8:Mode=="auth-pw-audit2"?(byte)2:(byte)0;
            return Rewrite(raw,cc,delegate(byte[] p){return new Wr().B2B(new byte[n]).U8(attrs).B2B(new byte[0]).Bytes();},true);
        }
        if(Mode.StartsWith("auth-policy-") && cc==Tpm.CC_NV_Increment && U32(cmd,22)!=Tpm.RS_PW) {
            return Rewrite(raw,cc,delegate(byte[] p){
                if(Mode=="auth-policy-password")return new Wr().B2B(new byte[0]).U8(1).B2B(new byte[0]).Bytes();
                Rd q=new Rd(p);byte[] nonce=q.B2B();q.U8();byte[] hm=q.B2B();
                return new Wr().B2B(Mode=="auth-policy-short"?new byte[16]:nonce).U8(Mode=="auth-policy-reserved3"?(byte)8:(byte)1).B2B(hm).Bytes();
            },true);
        }
        if((Mode.StartsWith("cd-")||Mode.StartsWith("creation")||Mode=="primary-name-flip") && cc==Tpm.CC_CreatePrimary)
            return Rewrite(raw,cc,delegate(byte[] p){return Creation(p,cc);},false);
        if(Mode=="create-cd-missing" && cc==Tpm.CC_Create)
            return Rewrite(raw,cc,delegate(byte[] p){return Creation(p,cc);},false);
        if(Mode=="session-policy-empty" && cc==Tpm.CC_StartAuthSession && starts==2)
            return Rewrite(raw,cc,delegate(byte[] p){return new Wr().B2B(new byte[0]).Bytes();},false);
        if(Mode=="session-handle-wrongclass" && cc==Tpm.CC_StartAuthSession) {
            Edits.Add("session-handle:"+Hex.U32(U32(raw,10))+"=>0x800000ff");Put32(raw,10,0x800000ff);Changes++;return raw;
        }
        if(Mode=="foreign-load-name" && cc==Tpm.CC_Load && loads==2)
            return Rewrite(raw,cc,delegate(byte[] p){p[p.Length-1]^=1;return p;},false);
        if(Mode.StartsWith("policy-ticket-") && cc==Tpm.CC_PolicySigned)
            return Rewrite(raw,cc,delegate(byte[] p){
                Rd q=new Rd(p);byte[] timeout=q.B2B();ushort tag=q.U16();uint hierarchy=q.U32();byte[] d=q.B2B();
                if(Mode=="policy-ticket-timeout")timeout=new byte[]{0xAA};
                if(Mode=="policy-ticket-hierarchy")hierarchy=0x40000002;
                if(Mode=="policy-ticket-digest")d=new byte[]{0xAA};
                return new Wr().B2B(timeout).U16(tag).U32(hierarchy).B2B(d).Bytes();
            },false);
        return raw;
    }
}

public static class IndependentR3
{
    private static string Q(string s) { return "\""+s.Replace("\\","\\\\").Replace("\"","\\\"").Replace("\r","\\r").Replace("\n","\\n")+"\""; }
    public static int Main(string[] args)
    {
        string mode=args[0];
        using(SwtpmLoopbackTransport inner=new SwtpmLoopbackTransport("127.0.0.1",5600)){
            IndependentR3Transport t=new IndependentR3Transport(inner,mode);
            List<uint> nvBefore=IndependentR3Transport.Inventory(inner,0x01000000);
            List<uint> transientBefore=IndependentR3Transport.Inventory(inner,0x80000000);
            List<uint> sessionsBefore=IndependentR3Transport.Inventory(inner,0x02000000);
            CeremonyReport report=new CeremonyRehearsal(t).Run(mode.StartsWith("post-inventory-")?"S1":"ALL");
            Console.Write("{\"mode\":"+Q(mode)+",\"changes\":"+t.Changes+",\"edits\":[");
            for(int i=0;i<t.Edits.Count;i++){if(i!=0)Console.Write(",");Console.Write(Q(t.Edits[i]));}
            Console.Write("],\"sentinels\":"+IndependentR3Transport.ListJson(t.Sentinels)+",\"flushed\":"+IndependentR3Transport.ListJson(t.Flushed));
            Console.Write(",\"nvBefore\":"+IndependentR3Transport.ListJson(nvBefore)+",\"transientsBefore\":"+IndependentR3Transport.ListJson(transientBefore)+",\"sessionsBefore\":"+IndependentR3Transport.ListJson(sessionsBefore));
            Console.Write(",\"nvAfter\":"+IndependentR3Transport.ListJson(IndependentR3Transport.Inventory(inner,0x01000000))+",\"transientsAfter\":"+IndependentR3Transport.ListJson(IndependentR3Transport.Inventory(inner,0x80000000))+",\"sessionsAfter\":"+IndependentR3Transport.ListJson(IndependentR3Transport.Inventory(inner,0x02000000)));
            Console.WriteLine(",\"report\":"+report.ToJson()+"}");
        }
        return 0;
    }
}
