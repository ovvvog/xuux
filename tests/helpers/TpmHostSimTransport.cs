// tests/helpers/TpmHostSimTransport.cs
//
// نقلُ اختبارٍ فقط (WL-410): يوصلُ نواةَ جردِ المضيفِ (sim/tpm-host/TpmInventoryCore.cs) بمحاكي
// swtpm على loopback، ويُسجِّلُ ما يبلغُ SubmitChecked لإثباتِ أنّ الحارسَ يسبقُ النقل.
// ليس جزءاً من أداةِ المضيفِ ولا يُحمَّلُ منها — فلا مسارَ احتياطيَّ إلى محاكٍ في الأداة.

using System;
using System.Collections.Generic;
using System.Net.Sockets;

namespace Xuux.TpmHost.Tests
{
    public sealed class SwtpmTcpTransport : Xuux.TpmHost.GuardedTransport, IDisposable
    {
        private readonly TcpClient _client;
        private readonly NetworkStream _stream;

        public SwtpmTcpTransport(string host, int port)
        {
            if (host != "127.0.0.1" && host != "::1") throw new ArgumentException("simulator transport is loopback-only");
            _client = new TcpClient(host, port);
            _stream = _client.GetStream();
            _stream.ReadTimeout = 10000;
        }

        public override string Kind { get { return "simulator:swtpm-tcp"; } }

        protected override Xuux.TpmHost.TransportResult SubmitChecked(byte[] checkedCommand)
        {
            _stream.Write(checkedCommand, 0, checkedCommand.Length);
            byte[] head = ReadExact(10);
            uint size = Xuux.TpmHost.Be.U32(head, 2);
            if (size < 10 || size > 65536) throw new InvalidOperationException("bad simulator response size");
            byte[] rest = ReadExact((int)size - 10);
            byte[] all = new byte[size];
            Array.Copy(head, all, 10);
            Array.Copy(rest, 0, all, 10, rest.Length);
            Xuux.TpmHost.TransportResult r = new Xuux.TpmHost.TransportResult();
            r.TransportCode = 0;
            r.Response = all;
            return r;
        }

        private byte[] ReadExact(int n)
        {
            byte[] b = new byte[n];
            int got = 0;
            while (got < n)
            {
                int k = _stream.Read(b, got, n - got);
                if (k <= 0) throw new InvalidOperationException("simulator closed the connection");
                got += k;
            }
            return b;
        }

        public void Dispose() { _stream.Dispose(); _client.Close(); }
    }

    // يُسجِّلُ كلَّ أمرٍ بلغَ النقلَ — والمطلوبُ في اختبارِ الرفضِ أن يبقى صفراً.
    public sealed class RecordingTransport : Xuux.TpmHost.GuardedTransport
    {
        public readonly List<string> Reached = new List<string>();
        public override string Kind { get { return "test:recording"; } }
        protected override Xuux.TpmHost.TransportResult SubmitChecked(byte[] checkedCommand)
        {
            Reached.Add(Xuux.TpmHost.Be.Hex(checkedCommand));
            Xuux.TpmHost.TransportResult r = new Xuux.TpmHost.TransportResult();
            r.TransportCode = 0;
            r.Response = new byte[] { 0x80, 0x01, 0, 0, 0, 10, 0, 0, 0, 0 };
            return r;
        }
    }
}
