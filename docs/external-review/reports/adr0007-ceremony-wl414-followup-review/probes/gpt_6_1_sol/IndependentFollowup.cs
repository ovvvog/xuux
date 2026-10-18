// Independent follow-up WL-414. Compiled alongside the unmodified target core.
// Only SwtpmLoopbackTransport("127.0.0.1",7100); no host TPM transport.
using System;
using System.IO;
using System.Collections.Generic;
using Xuux.TpmCeremony;

public sealed class FollowupTransport : ICeremonyTransport
{
    public readonly ICeremonyTransport Inner;
    public readonly string Mode;
    public uint A, B, Defined;
    public int Changes, InventoryPages;
    public readonly List<uint> Flushed = new List<uint>();
    public readonly List<uint> Deleted = new List<uint>();
    public readonly List<string> Events = new List<string>();
    public readonly List<string> Frames = new List<string>();
    public readonly List<string> Forwarded = new List<string>();
    public string Kind { get { return "independent-followup:"+Mode; } }
    public FollowupTransport(ICeremonyTransport inner, string mode) { Inner=inner; Mode=mode; }
    public static uint U32(byte[] b, int p) { return ((uint)b[p]<<24)|((uint)b[p+1]<<16)|((uint)b[p+2]<<8)|b[p+3]; }
    public static byte[] Slice(byte[] b,int p,int n) { byte[] a=new byte[n];Buffer.BlockCopy(b,p,a,0,n);return a; }
    public static byte[] Envelope(ushort tag,byte[] body) { return new Wr().U16(tag).U32((uint)(body.Length+10)).U32(0).Raw(body).Bytes(); }
    public static byte[] Page(byte more, params uint[] hs) {
        Wr w=new Wr().U8(more).U32(1).U32((uint)hs.Length);
        foreach(uint h in hs)w.U32(h);
        return Envelope(Tpm.ST_NO_SESSIONS,w.Bytes());
    }
    // Rebuild a success response while preserving its handles/authentication.
    private static byte[] Params(byte[] raw,int handles,Func<byte[],byte[]> f) {
        ushort tag=(ushort)((raw[0]<<8)|raw[1]); int p=10+handles*4;
        byte[] hs=Slice(raw,10,handles*4); byte[] prm,tail;
        if(tag==Tpm.ST_SESSIONS) {
            int n=(int)U32(raw,p);prm=Slice(raw,p+4,n);tail=Slice(raw,p+4+n,raw.Length-p-4-n);
            byte[] np=f(prm);
            return Envelope(tag,new Wr().Raw(hs).U32((uint)np.Length).Raw(np).Raw(tail).Bytes());
        }
        return Envelope(tag,new Wr().Raw(hs).Raw(f(Slice(raw,p,raw.Length-p))).Bytes());
    }
    private static byte[] Auth(byte[] raw,byte[] auth) {
        int n=(int)U32(raw,10);
        return Envelope(Tpm.ST_SESSIONS,new Wr().U32((uint)n).Raw(Slice(raw,14,n)).Raw(auth).Bytes());
    }
    private byte[] Edit(byte[] raw,string why,byte[] result) {
        Changes++; Events.Add(why);
        Frames.Add("edit "+why+" before="+Hex.Of(raw)+" after="+Hex.Of(result));
        return result;
    }
    private byte[] Creation(byte[] p,bool primary) {
        Rd r=new Rd(p); byte[] priv=primary?null:r.B2B(); byte[] pub=r.B2B(),cd=r.B2B(),ch=r.B2B();
        ushort tag=r.U16(); uint hier=r.U32();byte[] digest=r.B2B();byte[] tail=r.Raw(r.Remaining);
        if(Mode.StartsWith("creation-hierarchy-")) hier=Convert.ToUInt32(Mode.Substring(19),16);
        if(Mode.StartsWith("creation-digest-")) digest=new byte[int.Parse(Mode.Substring(16))];
        if(Mode=="creation-null-empty") {hier=Tpm.RH_NULL;digest=new byte[0];}
        if(Mode=="creation-hash-flip") ch[0]^=1;
        if(Mode=="creation-data-missing") { cd=Slice(cd,0,cd.Length-14); ch=Sha.H(cd); }
        if(Mode=="creation-data-extra") { cd=Sha.Concat(cd,new byte[]{0,0}); ch=Sha.H(cd); }
        if(Mode=="creation-parentalg-invalid") {int o=4+2+((cd[4]<<8)|cd[5])+1;cd[o]=255;cd[o+1]=255;ch=Sha.H(cd);}
        if(Mode=="creation-outsideinfo") { cd=Sha.Concat(Slice(cd,0,cd.Length-2),new byte[]{0,1,0x42});ch=Sha.H(cd); }
        if(Mode=="creation-parentname") {
            // Replace the first trailing TPM2B with one arbitrary byte, retaining all three fields.
            Rd c=new Rd(cd);c.U32();c.B2B();c.U8();c.U16();int o=cd.Length-c.Remaining;
            c.B2B();byte[] rest=c.Raw(c.Remaining);
            cd=Sha.Concat(Slice(cd,0,o),new byte[]{0,1,0x42},rest);ch=Sha.H(cd);
        }
        if(Mode=="creation-pcr-empty") {
            int n=(cd[4]<<8)|cd[5];cd=Sha.Concat(new byte[]{0,0,0,0,0,0},Slice(cd,6+n,cd.Length-6-n));ch=Sha.H(cd);
        }
        Wr w=new Wr();if(!primary)w.B2B(priv);
        return w.B2B(pub).B2B(cd).B2B(ch).U16(tag).U32(hier).B2B(digest).Raw(tail).Bytes();
    }
    public byte[] Transmit(byte[] command) {
        uint cc=U32(command,6); Frames.Add("request "+Hex.Of(command));
        if(cc==Tpm.CC_FlushContext) Flushed.Add(U32(command,10));
        if(cc==Tpm.CC_NV_UndefineSpace) Deleted.Add(U32(command,14));
        if(cc==Tpm.CC_NV_DefineSpace) {
            int n=(int)U32(command,14);Rd r=new Rd(Slice(command,18+n,command.Length-18-n));r.B2B();Defined=U32(r.B2B(),0);
        }
        if(Mode=="undefine-drop-before" && cc==Tpm.CC_NV_UndefineSpace && Changes==0) {
            Changes++;Events.Add("first normal undefine dropped before transmission");Frames.Add("throw FOLLOWUP_UNDEFINE_BEFORE_SEND");throw new IOException("FOLLOWUP_UNDEFINE_BEFORE_SEND");
        }
        if(Mode=="cleanup-undefine-before" && cc==Tpm.CC_NV_Increment && Changes==0) {
            Changes++;Events.Add("return injected TPM failure to enter cleanup before any undefine");
            return new Wr().U16(Tpm.ST_NO_SESSIONS).U32(10).U32(0x101).Bytes();
        }
        if(Mode=="cleanup-undefine-before" && cc==Tpm.CC_NV_UndefineSpace && Changes==1) {
            Changes++;Events.Add("cleanup undefine dropped before transmission");Frames.Add("throw FOLLOWUP_CLEANUP_UNDEFINE_BEFORE_SEND");throw new IOException("FOLLOWUP_CLEANUP_UNDEFINE_BEFORE_SEND");
        }
        if(Mode=="loss-define-foreign-matching" && cc==Tpm.CC_NV_DefineSpace && Changes==0) {
            int n=(int)U32(command,14);Rd r=new Rd(Slice(command,18+n,command.Length-18-n));r.B2B();byte[] pub=r.B2B();
            byte[] seed=Inner.Transmit(Cmd.NvDefineSpace(new byte[0],new byte[]{0x55},pub));
            Frames.Add("foreign matching seed reply "+Hex.Of(seed));Events.Add("foreign seed matching public, different index auth rc="+Hex.U32(U32(seed,6)));
            if(U32(seed,6)!=0)throw new Exception("matching foreign seed rejected");
        }
        if(cc==Tpm.CC_GetCapability && U32(command,10)==1) {
            uint prop=U32(command,14);
            if(Mode=="partial-transient" && prop==0x80000000u && Changes==0) {Changes++;Events.Add("actual IO exception during transient baseline");Frames.Add("throw partial transient");throw new IOException("FOLLOWUP_PARTIAL_TRANSIENT");}
            if(Mode=="partial-session" && prop==0x02000000u && Changes==0) {Changes++;Events.Add("actual IO exception during session baseline");Frames.Add("throw partial session");throw new IOException("FOLLOWUP_PARTIAL_SESSION");}
        }
        Forwarded.Add(Hex.U32(cc));Frames.Add("forward "+Hex.Of(command));
        byte[] raw=Inner.Transmit(command); Frames.Add("response "+Hex.Of(raw));
        if(Mode=="loss-define-foreign-matching" && cc==Tpm.CC_NV_DefineSpace && Changes==0) {
            Changes++;Events.Add("actual ceremony define reply rc="+Hex.U32(U32(raw,6))+" discarded");throw new IOException("FOLLOWUP_FOREIGN_MATCHING_LOST_DEFINE");
        }
        if(Mode=="loss-define" && cc==Tpm.CC_NV_DefineSpace && U32(raw,6)==0 && Changes==0) {
            Changes++;Events.Add("discarded actual successful NV_DefineSpace response after execution");Frames.Add("throw FOLLOWUP_ACTUAL_RESPONSE_LOSS");throw new IOException("FOLLOWUP_ACTUAL_RESPONSE_LOSS");
        }
        if(Mode=="loss-create" && cc==Tpm.CC_Create && U32(raw,6)==0 && Changes==0) {
            Changes++;Events.Add("discarded successful Create response");throw new IOException("FOLLOWUP_CREATE_RESPONSE_LOSS");
        }
        if(U32(raw,6)!=0)return raw;
        if(cc==Tpm.CC_GetCapability && U32(command,10)==1 && Changes==0) {
            if((Mode=="partial-transient-badclass" && U32(command,14)==0x80000000u) ||
               (Mode=="partial-session-badclass" && U32(command,14)==0x02000000u))
                return Edit(raw,Mode,Page(0,0x01000001));
        }
        if(cc==Tpm.CC_GetCapability && U32(command,10)==1 && U32(command,14)>=0x80000000u) {
            uint prop=U32(command,14);
            if(Mode=="duplicate-alias" && prop==0x80000000u && Changes==0) return Edit(raw,"baseline hides B with duplicate A",Page(0,A,A));
            if(Mode=="duplicate-many" && prop==0x80000000u && Changes==0) return Edit(raw,"multiple repeats within page",Page(0,A,A,A,B,B));
            if(Mode=="descending" && prop==0x80000000u && Changes==0) return Edit(raw,"descending",Page(0,B,A));
            if(Mode=="cross-page" && InventoryPages<2) {
                InventoryPages++;return Edit(raw,"cross-page "+InventoryPages,InventoryPages==1?Page(1,A):Page(0,A,B));
            }
            if(Mode=="below-start" && InventoryPages<2) {
                InventoryPages++;return Edit(raw,"below-start "+InventoryPages,InventoryPages==1?Page(1,0x80000010u):Page(0,0x80000005u));
            }
        }
        if(cc==Tpm.CC_CreatePrimary && Mode=="duplicate-alias" && Changes==1) {
            byte[] f=(byte[])raw.Clone();Buffer.BlockCopy(new Wr().U32(B).Bytes(),0,f,10,4);
            return Edit(raw,"replace created handle with hidden victim B",f);
        }
        if(cc==Tpm.CC_NV_DefineSpace && Mode=="auth-policy-on-password" && Changes==0)
            return Edit(raw,"policy auth profile on RS_PW command",Auth(raw,new Wr().B2B(new byte[32]).U8(0).B2B(new byte[0]).Bytes()));
        if(cc==Tpm.CC_NV_Increment && ((command[0]<<8)|command[1])==Tpm.ST_SESSIONS && U32(command,22)!=Tpm.RS_PW && Changes==0) {
            if(Mode=="auth-password-on-policy")return Edit(raw,"RS_PW profile on policy command",Auth(raw,new Wr().B2B(new byte[0]).U8(1).B2B(new byte[0]).Bytes()));
            if(Mode=="auth-policy-nonce16")return Edit(raw,"policy nonce16",Auth(raw,new Wr().B2B(new byte[16]).U8(0).B2B(new byte[0]).Bytes()));
            if(Mode=="auth-policy-attrs08")return Edit(raw,"policy reserved bit",Auth(raw,new Wr().B2B(new byte[32]).U8(8).B2B(new byte[0]).Bytes()));
        }
        if(cc==Tpm.CC_CreatePrimary && Mode.StartsWith("creation-") && Changes==0)
            return Edit(raw,Mode,Params(raw,1,delegate(byte[] p){return Creation(p,true);}));
        if(cc==Tpm.CC_PolicySigned && Mode.StartsWith("policy-") && Changes==0) {
            return Edit(raw,Mode,Params(raw,0,delegate(byte[] p) {
                Rd r=new Rd(p);byte[] timeout=r.B2B();ushort tag=r.U16();uint h=r.U32();byte[] d=r.B2B();
                if(Mode.StartsWith("policy-hierarchy-"))h=Convert.ToUInt32(Mode.Substring(17),16);
                if(Mode.StartsWith("policy-digest-"))d=new byte[int.Parse(Mode.Substring(14))];
                if(Mode.StartsWith("policy-tag-"))tag=Convert.ToUInt16(Mode.Substring(11),16);
                if(Mode=="policy-timeout")timeout=new byte[]{0x42};
                return new Wr().B2B(timeout).U16(tag).U32(h).B2B(d).Bytes();
            }));
        }
        if(cc==Tpm.CC_Load && Mode=="load-name-flip" && Changes==0)
            return Edit(raw,Mode,Params(raw,1,delegate(byte[] p){p[p.Length-1]^=1;return p;}));
        return raw;
    }
}
public static class FollowupMain {
    public static string J(string x) {return x==null?"null":"\""+x.Replace("\\","\\\\").Replace("\"","\\\"").Replace("\n","\\n").Replace("\r","\\r")+"\"";}
    public static string Strings(IEnumerable<string> xs) {List<string> a=new List<string>();foreach(string x in xs)a.Add(J(x));return "["+String.Join(",",a.ToArray())+"]";}
    public static string Handles(IEnumerable<uint> xs) {List<string> a=new List<string>();foreach(uint x in xs)a.Add(Hex.U32(x));return Strings(a);}
    public static uint[] Inventory(ICeremonyTransport t,uint start) {
        byte[] b=t.Transmit(Cmd.GetCapability(1,start,64));Rd r=new Rd(b);r.Raw(10);r.U8();r.U32();uint n=r.U32();
        List<uint> hs=new List<uint>();for(int i=0;i<n;i++)hs.Add(r.U32());return hs.ToArray();
    }
    public static int Main(string[] args) {
        string mode=args[0],dir=args[1];
        using(SwtpmLoopbackTransport inner=new SwtpmLoopbackTransport("127.0.0.1",7100)) {
            FollowupTransport t=new FollowupTransport(inner,mode);
            bool seeds=mode=="duplicate-alias"||mode=="duplicate-many"||mode=="descending"||mode=="cross-page"||mode=="below-start";
            if(seeds) {
                byte[] a=inner.Transmit(Cmd.CreatePrimary(new byte[0],Templates.StoragePrimary()));
                byte[] b=inner.Transmit(Cmd.CreatePrimary(new byte[0],Templates.StoragePrimary()));
                if(FollowupTransport.U32(a,6)!=0||FollowupTransport.U32(b,6)!=0)throw new Exception("seed primary rejected");
                t.A=FollowupTransport.U32(a,10);t.B=FollowupTransport.U32(b,10);
            }
            // A genuine foreign index exists before baseline and is never owned by the ceremony.
            uint foreign=0x01807777;
            if(mode=="loss-define"||mode=="normal-foreign") {
                byte[] p=Cmd.NvPublic(foreign,Tpm.S1_PROBE_ATTRIBUTES,new byte[0],8);
                byte[] r=inner.Transmit(Cmd.NvDefineSpace(new byte[0],new byte[]{0x77},p));
                if(FollowupTransport.U32(r,6)!=0)throw new Exception("seed NV rejected");
            }
            uint[] trBefore=Inventory(inner,0x80000000), nvBefore=Inventory(inner,0x01000000);
            string stages=seeds?"S2":"ALL";
            CeremonyReport report=new CeremonyRehearsal(t).Run(stages);
            uint[] trAfter=Inventory(inner,0x80000000),nvAfter=Inventory(inner,0x01000000),seAfter=Inventory(inner,0x02000000);
            File.WriteAllLines(Path.Combine(dir,mode+".frames.txt"),t.Frames.ToArray());
            Console.WriteLine("{\"mode\":"+J(mode)+",\"changes\":"+t.Changes+",\"events\":"+Strings(t.Events)+
                ",\"seedA\":"+J(Hex.U32(t.A))+",\"seedB\":"+J(Hex.U32(t.B))+",\"defined\":"+J(Hex.U32(t.Defined))+
                ",\"forwarded\":"+Strings(t.Forwarded)+
                ",\"flushed\":"+Handles(t.Flushed)+",\"deleted\":"+Handles(t.Deleted)+
                ",\"transientsBefore\":"+Handles(trBefore)+",\"transientsAfter\":"+Handles(trAfter)+
                ",\"nvBefore\":"+Handles(nvBefore)+",\"nvAfter\":"+Handles(nvAfter)+",\"sessionsAfter\":"+Handles(seAfter)+
                ",\"report\":"+report.ToJson()+"}");
        }
        return 0;
    }
}
