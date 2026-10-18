using System;
using System.IO;
using Xuux.TpmCeremony;
public static class TagDump {
    public static int Main(string[] args) {
        string state = Path.Combine(args[0], "st-tagdump");
        if (Directory.Exists(state)) Directory.Delete(state, true);
        Directory.CreateDirectory(state);
        var sw = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("swtpm",
            "socket --tpm2 --tpmstate dir=" + state + " --server type=tcp,port=4700,bindaddr=127.0.0.1" +
            " --ctrl type=tcp,port=4701,bindaddr=127.0.0.1 --flags not-need-init,startup-clear --pid file=" + args[0] + "/pid-tagdump --daemon"));
        sw.WaitForExit(); System.Threading.Thread.Sleep(500);
        using (var t = new SwtpmLoopbackTransport("127.0.0.1", 4700)) {
            // StartAuthSession (بلا جلسات)
            byte[] z = new byte[32]; new System.Random(7).NextBytes(z);
            byte[] r1 = t.Transmit(Cmd.StartAuthSession(Tpm.SE_TRIAL, z));
            Console.WriteLine("StartAuthSession resp: tag=0x" + ((r1[0]<<8)|r1[1]).ToString("x4") + " size=" + ((r1[2]<<24)|(r1[3]<<16)|(r1[4]<<8)|r1[5]) + " rc=0x" + ((r1[6]<<24)|(r1[7]<<16)|(r1[8]<<8)|r1[9]).ToString("x8"));
            // PolicySigned سلبي (رفض متوقع) — ردُّ الخطأِ
            byte[] r2 = t.Transmit(Cmd.PolicySigned(0x80000001, 0x03000000, z, 0, z, z));
            Console.WriteLine("PolicySigned(neg) resp: tag=0x" + ((r2[0]<<8)|r2[1]).ToString("x4") + " size=" + ((r2[2]<<24)|(r2[3]<<16)|(r2[4]<<8)|r2[5]) + " rc=0x" + ((r2[6]<<24)|(r2[7]<<16)|(r2[8]<<8)|r2[9]).ToString("x8"));
        }
        try { System.Diagnostics.Process.Start("kill", File.ReadAllText(args[0] + "/pid-tagdump").Trim()); } catch {}
        return 0;
    }
}
