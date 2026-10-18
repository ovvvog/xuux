// Independent WL-413 review, gpt_6_1_sol. Simulator loopback only.
// Test artefact, not a proposed patch to the reviewed implementation.
using System;
using System.IO;
using System.Collections.Generic;
using Xuux.TpmCeremony;
using Xuux.TpmCeremony.Tests;

public sealed class AuditFault : ICeremonyTransport
{
    readonly ICeremonyTransport inner;
    readonly string mode;
    public int Changes;
    public uint Sentinel;
    public uint NewPrimary;
    public uint ExtraSession;
    public string BeforeResponse;
    public string AfterResponse;
    int starts;
    int signed;
    bool post;
    uint target;
    public AuditFault(ICeremonyTransport i, string m) {
        inner=i; mode=m;
        if (mode.StartsWith("trailing-")) target=Convert.ToUInt32(mode.Substring(9),16);
    }
    public string Kind { get { return "independent-wl413:"+mode; } }
    static uint U32(byte[] x,int p) {
        return ((uint)x[p]<<24)|((uint)x[p+1]<<16)|((uint)x[p+2]<<8)|x[p+3];
    }
    static byte[] Response(ushort tag, byte[] body) {
        return new Wr().U16(tag).U32((uint)(10+body.Length)).U32(0).Raw(body).Bytes();
    }
    static byte[] ReplaceB2B(byte[] p,int field,byte[] value) {
        Rd r=new Rd(p); Wr w=new Wr();
        for(int j=0;j<field;j++) w.B2B(r.B2B());
        r.B2B(); w.B2B(value).Raw(r.Raw(r.Remaining)); return w.Bytes();
    }
    byte[] Changed(byte[] was,byte[] now) {
        Changes++; BeforeResponse=Hex.Of(was); AfterResponse=Hex.Of(now); return now;
    }
    public byte[] Transmit(byte[] cmd) {
        uint cc=U32(cmd,6);
        if(cc==Tpm.CC_StartAuthSession) starts++;
        if(cc==Tpm.CC_PolicySigned) signed++;
        byte[] raw=inner.Transmit(cmd);
        uint rc=U32(raw,6);
        if(mode=="negative-valid-success" && cc==Tpm.CC_NV_Read && Changes==0) {
            byte[] negParams=new Wr().B2B(new byte[8]).Bytes();
            byte[] negBody=new Wr().U32((uint)negParams.Length).Raw(negParams).B2B(new byte[0]).U8(1).B2B(new byte[0]).Bytes();
            return Changed(raw,Response(Tpm.ST_SESSIONS,negBody));
        }
        if(mode=="negative-policy-loss" && cc==Tpm.CC_PolicySigned && signed==3) {
            Changes++; throw new IOException("INDEPENDENT_LOST_NEGATIVE_POLICYSIGNED_REPLY");
        }
        if(mode=="create-loss" && cc==Tpm.CC_Create && Changes==0) {
            Changes++; throw new IOException("INDEPENDENT_LOST_CREATE_REPLY");
        }
        if(mode=="malformed-absence" && cc==Tpm.CC_NV_DefineSpace && Changes==0) {
            Changes++; throw new IOException("INDEPENDENT_LOST_DEFINE_REPLY");
        }
        if(mode=="malformed-absence" && cc==Tpm.CC_NV_ReadPublic && Changes==1) {
            byte[] n=new Wr().U16(0x1234).U32(10).U32(Tpm.RC_HANDLE).Bytes();
            return Changed(raw,n);
        }
        if(rc!=0) return raw;
        ushort tag=(ushort)((raw[0]<<8)|raw[1]);
        int nh=(cc==Tpm.CC_CreatePrimary||cc==Tpm.CC_Load||cc==Tpm.CC_StartAuthSession)?1:0;
        if(cc==Tpm.CC_CreatePrimary) NewPrimary=U32(raw,10);
        if(mode=="handle-baseline-alias" && cc==Tpm.CC_CreatePrimary && Changes==0) {
            byte[] n=(byte[])raw.Clone(); byte[] h=new Wr().U32(Sentinel).Bytes();
            Buffer.BlockCopy(h,0,n,10,4); return Changed(raw,n);
        }
        if((mode=="inventory-empty-more"||mode=="inventory-wrong-range") &&
           cc==Tpm.CC_FlushContext && U32(cmd,10)==NewPrimary) {
            // Simulate an unrelated session appearing after cleanup, before final inventory.
            byte[] q=inner.Transmit(Cmd.StartAuthSession(Tpm.SE_POLICY,new byte[32]));
            ExtraSession=U32(q,10); post=true;
        }
        if(post && (mode=="inventory-empty-more"||mode=="inventory-wrong-range") &&
           cc==Tpm.CC_GetCapability && U32(cmd,10)==1 && U32(cmd,14)==0x02000000) {
            byte[] p=mode=="inventory-empty-more"
                ? new Wr().U8(1).U32(1).U32(0).Bytes()
                : new Wr().U8(1).U32(1).U32(1).U32(0x40000001).Bytes();
            return Changed(raw,Response(Tpm.ST_NO_SESSIONS,p));
        }
        Rd r=new Rd(raw); r.Raw(10);
        byte[] hs=r.Raw(4*nh);
        byte[] prm;
        byte[] auth=new byte[0];
        if(tag==Tpm.ST_SESSIONS) { uint ps=r.U32(); prm=r.Raw((int)ps); auth=r.Raw(r.Remaining); }
        else prm=r.Raw(r.Remaining);
        byte[] np=prm; byte[] na=auth;
        bool hit=false;
        if(mode.StartsWith("trailing-") && cc==target && Changes==0) {
            np=Sha.Concat(prm,new byte[]{0xA5}); hit=true;
        }
        if(cc==Tpm.CC_NV_DefineSpace && Changes==0) {
            if(mode=="auth-nonce") { na=new Wr().B2B(new byte[]{0x42}).U8(1).B2B(new byte[0]).Bytes(); hit=true; }
            if(mode=="auth-hmac") { na=new Wr().B2B(new byte[0]).U8(1).B2B(new byte[]{0x42}).Bytes(); hit=true; }
            if(mode=="auth-reserved") { na=new Wr().B2B(new byte[0]).U8(0xFF).B2B(new byte[0]).Bytes(); hit=true; }
            if(mode=="auth-continue-cleared") { na=new Wr().B2B(new byte[0]).U8(0).B2B(new byte[0]).Bytes(); hit=true; }
        }
        if(cc==Tpm.CC_CreatePrimary && Changes==0) {
            if(mode=="primary-empty-public") { np=ReplaceB2B(prm,0,new byte[0]); hit=true; }
            if(mode=="primary-invalid-creationdata") { np=ReplaceB2B(prm,1,new byte[]{0xFF}); hit=true; }
            if(mode=="primary-wrong-name") {
                np=(byte[])prm.Clone(); np[np.Length-1]^=0x80; hit=true;
            }
        }
        if(cc==Tpm.CC_Create && mode=="create-invalid-creationdata" && Changes==0) {
            np=ReplaceB2B(prm,2,new byte[]{0xFF}); hit=true;
        }
        if(cc==Tpm.CC_Create && mode=="create-empty-private" && Changes==0) {
            np=ReplaceB2B(prm,0,new byte[0]); hit=true;
        }
        if(cc==Tpm.CC_CreatePrimary && mode=="primary-ticket-invalid" && Changes==0) {
            Rd t=new Rd(prm); Wr w=new Wr();
            w.B2B(t.B2B()).B2B(t.B2B()).B2B(t.B2B());
            t.U16(); t.U32(); w.U16(0xFFFF).U32(0xDEADBEEF).Raw(t.Raw(t.Remaining));
            np=w.Bytes(); hit=true;
        }
        if(cc==Tpm.CC_Sign && mode=="signature-empty-r" && Changes==0) {
            Rd t=new Rd(prm); Wr w=new Wr().U16(t.U16()).U16(t.U16());
            t.B2B(); w.B2B(new byte[0]).Raw(t.Raw(t.Remaining)); np=w.Bytes(); hit=true;
        }
        if(cc==Tpm.CC_PolicySigned && mode=="policy-invalid-ticket" && Changes==0) {
            np=new Wr().B2B(new byte[0]).U16(0xFFFF).U32(0xDEADBEEF).B2B(new byte[0]).Bytes(); hit=true;
        }
        if(cc==Tpm.CC_StartAuthSession && mode=="start-trial-empty-nonce" && starts==1 && Changes==0) {
            np=new Wr().B2B(new byte[0]).Bytes(); hit=true;
        }
        if(cc==Tpm.CC_StartAuthSession && mode=="start-policy-empty-nonce" && starts==2 && Changes==0) {
            np=new Wr().B2B(new byte[0]).Bytes(); hit=true;
        }
        if(!hit) return raw;
        Wr body=new Wr().Raw(hs);
        if(tag==Tpm.ST_SESSIONS) body.U32((uint)np.Length).Raw(np).Raw(na);
        else body.Raw(np);
        return Changed(raw,Response(tag,body.Bytes()));
    }
}

public static class AuditProgram
{
    static uint U32(byte[] x,int p) { return ((uint)x[p]<<24)|((uint)x[p+1]<<16)|((uint)x[p+2]<<8)|x[p+3]; }
    static List<uint> Handles(ICeremonyTransport t,uint start) {
        Resp p=Resp.Parse(t.Transmit(Cmd.GetCapability(1,start,64)),0,Tpm.ST_NO_SESSIONS,0);
        if(p.Rc!=0) throw new Exception("independent inventory rc="+Hex.U32(p.Rc));
        Rd r=new Rd(p.Params); r.U8(); r.U32(); uint n=r.U32(); List<uint> hs=new List<uint>();
        for(uint i=0;i<n;i++) hs.Add(r.U32()); return hs;
    }
    static string J(List<uint> xs) {
        List<string> s=new List<string>(); foreach(uint x in xs) s.Add("\""+Hex.U32(x)+"\"");
        return "["+string.Join(",",s.ToArray())+"]";
    }
    public static int Main(string[] a) {
        string mode=a[0]; int port=int.Parse(a[1]);
        using(SwtpmLoopbackTransport t=new SwtpmLoopbackTransport("127.0.0.1",port)) {
            uint sentinel=0;
            if(mode=="handle-baseline-alias") {
                byte[] rsp=t.Transmit(Cmd.CreatePrimary(new byte[0],Templates.StoragePrimary()));
                if(U32(rsp,6)!=0) throw new Exception("sentinel creation failed");
                sentinel=U32(rsp,10);
            }
            List<uint> nv0=Handles(t,0x01000000), se0=Handles(t,0x02000000), tr0=Handles(t,0x80000000);
            ICeremonyTransport f;
            AuditFault own=null;
            if(mode=="gemini:truncate") f=new Xuux.TpmCeremony.Probes.MalformedHeaderTransport();
            else if(mode=="gemini:size") f=new Xuux.TpmCeremony.Probes.SizeMismatchTransport();
            else if(mode=="gemini:blocked") f=new Xuux.TpmCeremony.Probes.TbsBlockedTransport();
            else if(mode.StartsWith("g47:")) f=new Xuux.TpmCeremony.Probes.ScriptedTransport(t,mode.Substring(4));
            else if(mode.StartsWith("old:")) f=new IndependentReview.Fault(t,mode.Substring(4));
            else if(mode.StartsWith("r2:")) f=new R2Fault(t,mode.Substring(3));
            else if(mode.StartsWith("helper:")) f=new CeremonyFaultTransport(t,mode.Substring(7));
            else { own=new AuditFault(t,mode); own.Sentinel=sentinel; f=own; }
            string stages=mode=="handle-baseline-alias"||mode.StartsWith("inventory-")?"S2":"ALL";
            CeremonyReport report=new CeremonyRehearsal(f).Run(stages);
            List<uint> nv1=Handles(t,0x01000000), se1=Handles(t,0x02000000), tr1=Handles(t,0x80000000);
            Console.WriteLine("{\"mode\":\""+mode+"\",\"nvBefore\":"+J(nv0)+",\"sessionsBefore\":"+J(se0)+",\"transientsBefore\":"+J(tr0)
                +",\"nvAfter\":"+J(nv1)+",\"sessionsAfter\":"+J(se1)+",\"transientsAfter\":"+J(tr1)
                +",\"sentinel\":\""+Hex.U32(sentinel)+"\",\"changes\":"+(own==null?-1:own.Changes)
                +",\"beforeResponse\":\""+(own==null?"":own.BeforeResponse)+"\",\"afterResponse\":\""+(own==null?"":own.AfterResponse)
                +"\",\"report\":"+report.ToJson()+"}");
            // Leave simulator observations untouched. Each potentially residual-producing
            // run is followed by private simulator restart by the shell driver.
        }
        return 0;
    }
}
