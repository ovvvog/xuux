using System;
using Xuux.TpmCeremony;
public static class ParserChecks {
    static void Case(string name,byte[] raw,int handles,ushort tag,int auth) {
        string result;
        try { Resp.Parse(raw,handles,tag,auth); result="accepted"; }
        catch(Exception e) { result=e.GetType().Name+": "+e.Message; }
        Console.WriteLine("{\"case\":\""+name+"\",\"result\":\""+result+"\"}");
    }
    static byte[] S(byte[] body) { return new Wr().U16(Tpm.ST_SESSIONS).U32((uint)(10+body.Length)).U32(0).Raw(body).Bytes(); }
    public static int Main() {
        Case("short-header",new byte[9],0,Tpm.ST_NO_SESSIONS,0);
        Case("declared-size-mismatch",new Wr().U16(Tpm.ST_NO_SESSIONS).U32(11).U32(0).Bytes(),0,Tpm.ST_NO_SESSIONS,0);
        Case("invalid-tag",new Wr().U16(0x1234).U32(10).U32(0).Bytes(),0,Tpm.ST_NO_SESSIONS,0);
        Case("missing-response-handle",new Wr().U16(Tpm.ST_NO_SESSIONS).U32(10).U32(0).Bytes(),1,Tpm.ST_NO_SESSIONS,0);
        Case("missing-auth",S(new Wr().U32(0).Bytes()),0,Tpm.ST_SESSIONS,1);
        Case("parameterSize-exceeds-body",S(new Wr().U32(99).Bytes()),0,Tpm.ST_SESSIONS,1);
        Case("parameterSize-u32-overflow",S(new Wr().U32(0xFFFFFFFF).Bytes()),0,Tpm.ST_SESSIONS,1);
        Case("truncated-auth-nonce",S(new Wr().U32(0).U16(2).U8(1).Bytes()),0,Tpm.ST_SESSIONS,1);
        Case("extra-auth-entry",S(new Wr().U32(0).B2B(new byte[0]).U8(1).B2B(new byte[0]).B2B(new byte[0]).U8(1).B2B(new byte[0]).Bytes()),0,Tpm.ST_SESSIONS,1);
        Case("error-with-sessions-tag",new Wr().U16(Tpm.ST_SESSIONS).U32(10).U32(0x101).Bytes(),0,Tpm.ST_NO_SESSIONS,0);
        Case("error-with-body",new Wr().U16(Tpm.ST_NO_SESSIONS).U32(11).U32(0x101).U8(0).Bytes(),0,Tpm.ST_NO_SESSIONS,0);
        Case("wrong-class-response-handle",new Wr().U16(Tpm.ST_NO_SESSIONS).U32(16).U32(0).U32(0x01000000).B2B(new byte[0]).Bytes(),1,Tpm.ST_NO_SESSIONS,0);
        return 0;
    }
}
